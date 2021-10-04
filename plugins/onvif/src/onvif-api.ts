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
    mainProfileToken: Promise<string>;
    snapshotUri: string;
    rtspUrl: string;

    constructor(public cam: any, username: string, password: string, public console: Console) {
        this.digestAuth = new DigestClient(username, password);
    }

    listenEvents() {
        const ret = new EventEmitter();

        this.cam.on('event', (event: any, xml: string) => {
            const eventTopic = stripNamespaces(event.topic._)
            // this.console.log('event', eventTopic);
            // this.console.log(JSON.stringify(event, null, 2));
            // this.console.log(xml);

            if (event.message.message.data && event.message.message.data.simpleItem) {
                const dataValue = event.message.message.data.simpleItem.$.Value
                if (eventTopic.includes('MotionAlarm')) {
                    // ret.emit('event', OnvifEvent.MotionBuggy);
                    if (dataValue)
                        ret.emit('event', OnvifEvent.MotionStart)
                    else
                        ret.emit('event', OnvifEvent.MotionStop)
                } else if (eventTopic.includes('DetectedSound')) {
                    if (dataValue)
                        ret.emit('event', OnvifEvent.AudioStart)
                    else
                        ret.emit('event', OnvifEvent.AudioStop)
                }
            }
        });
        return ret;
    }

    async getMainProfileToken() {
        if (this.mainProfileToken)
            return this.mainProfileToken;
        this.mainProfileToken = promisify(cb => this.cam.getProfiles(cb)).then(profiles => {
            const { token } = profiles[0].$;
            return token;
        });
        this.mainProfileToken.catch(() => this.mainProfileToken = undefined);
        return this.mainProfileToken;
    }

    async getStreamUrl(): Promise<string> {
        if (!this.rtspUrl) {
            const token = await this.getMainProfileToken();
            const result = await promisify(cb => this.cam.getStreamUri({ protocol: 'RTSP', profileToken: token }, cb)) as any;
            this.rtspUrl = result.uri;
        }
        return this.rtspUrl;
    }

    async jpegSnapshot(): Promise<Buffer> {
        if (!this.snapshotUri) {
            const token = await this.getMainProfileToken();
            const result = await promisify(cb => this.cam.getSnapshotUri({ profileToken: token }, cb)) as any;
            this.snapshotUri = result.uri;
        }

        const response = await this.digestAuth.fetch(this.snapshotUri);
        const buffer = await response.arrayBuffer();

        return Buffer.from(buffer);
    }
}

export async function connectCameraAPI(ipAndPort: string, username: string, password: string, console: Console) {
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

    return new OnvifCameraAPI(cam, username, password, console);
}