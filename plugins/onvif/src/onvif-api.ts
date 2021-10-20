import { EventEmitter, once } from 'events';
import DigestClient from './digest-client';

const onvif = require('onvif');
const { Cam } = onvif;

export enum OnvifEvent {
    // some onvif cameras spam motion events with IsMotion value as false.
    // just use a timeout based approach.
    MotionBuggy,
    MotionStart,
    MotionStop,
    AudioStart,
    AudioStop,
    BinaryStart,
    BinaryStop,
}

function stripNamespaces(topic: string) {
    // example input :-   tns1:MediaControl/tnsavg:ConfigurationUpdateAudioEncCfg 
    // Split on '/'
    // For each part, remove any namespace
    // Recombine parts that were split with '/'
    let output = '';
    let parts = topic.split('/')
    for (let index = 0; index < parts.length; index++) {
        let stringNoNamespace = parts[index].split(':').pop() // split on :, then return the last item in the array
        if (output.length == 0) {
            output += stringNoNamespace
        } else {
            output += '/' + stringNoNamespace
        }
    }
    return output
}

async function promisify<T>(block: (callback: (err: Error, value: T) => void) => void): Promise<T> {
    return new Promise((resolve, reject) => {
        block((err, value) => {
            if (err) return reject(err);
            resolve(value);
        });
    })
}

export class OnvifCameraAPI {
    digestAuth: DigestClient;
    snapshotUrls = new Map<string, string>();
    rtspUrls = new Map<string, string>();
    profiles: Promise<any>;
    binaryStateEvent: string;

    constructor(public cam: any, username: string, password: string, public console: Console, binaryStateEvent: string, public debug?: boolean) {
        this.digestAuth = new DigestClient(username, password);
        this.binaryStateEvent = binaryStateEvent
    }

    listenEvents() {
        const ret = new EventEmitter();

        this.cam.on('event', (event: any, xml: string) => {
            const eventTopic = stripNamespaces(event.topic._)
            if (this.debug) {
                this.console.log('event', eventTopic);
                this.console.log(JSON.stringify(event, null, 2));
                this.console.log(xml);
            }

            if (event.message.message.data && event.message.message.data.simpleItem) {
                const dataValue = event.message.message.data.simpleItem.$.Value
                if (eventTopic.includes('MotionAlarm')) {
                    // ret.emit('event', OnvifEvent.MotionBuggy);
                    if (dataValue)
                        ret.emit('event', OnvifEvent.MotionStart)
                    else
                        ret.emit('event', OnvifEvent.MotionStop)
                }
                else if (eventTopic.includes('DetectedSound')) {
                    if (dataValue)
                        ret.emit('event', OnvifEvent.AudioStart)
                    else
                        ret.emit('event', OnvifEvent.AudioStop)
                } else if (eventTopic.includes(this.binaryStateEvent)) {
                    if (dataValue)
                        ret.emit('event', OnvifEvent.BinaryStart)
                    else
                        ret.emit('event', OnvifEvent.BinaryStop)
                }
            }
        });
        return ret;
    }

    async getProfiles() {
        if (!this.profiles) {
            this.profiles = promisify(cb => this.cam.getProfiles(cb));
            this.profiles.catch(() => this.profiles = undefined);
        }
        return this.profiles;
    }

    async getMainProfileToken() {
        const profiles = await this.getProfiles();
        const { token } = profiles[0].$;
        return token;
    }

    async getStreamUrl(profileToken?: string): Promise<string> {
        if (!profileToken)
            profileToken = await this.getMainProfileToken();
        if (!this.rtspUrls.has(profileToken)) {
            const result = await promisify(cb => this.cam.getStreamUri({ protocol: 'RTSP', profileToken }, cb)) as any;
            const url = result.uri;
            this.rtspUrls.set(profileToken, url);
        }
        return this.rtspUrls.get(profileToken);
    }

    async jpegSnapshot(profileToken?: string): Promise<Buffer|undefined> {
        if (!profileToken)
            profileToken = await this.getMainProfileToken();
        if (!this.snapshotUrls.has(profileToken)) {
            try {
                const result = await promisify(cb => this.cam.getSnapshotUri({ profileToken }, cb)) as any;
                const url = result.uri;
                this.snapshotUrls.set(profileToken, url);
            }
            catch (e) {
                if (e.message && e.message.indexOf('ActionNotSupported') !== -1) {
                    this.snapshotUrls.set(profileToken, undefined);
                }
                else {
                    throw e;
                }
            }
        }
        const snapshotUri = this.snapshotUrls.get(profileToken);
        if (!snapshotUri)
            return;

        const response = await this.digestAuth.fetch(snapshotUri);
        const buffer = await response.arrayBuffer();

        return Buffer.from(buffer);
    }
}

export async function connectCameraAPI(ipAndPort: string, username: string, password: string, console: Console, binaryStateEvent: string, debugLog?: boolean) {
    const split = ipAndPort.split(':');
    const [hostname, port] = split;
    const cam = await promisify(cb => {
        const cam = new Cam({
            hostname,
            username,
            password,
            port,
        }, (err: Error) => cb(err, cam));
    });
    return new OnvifCameraAPI(cam, username, password, console, binaryStateEvent, debugLog);
}
