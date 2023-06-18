import { EventEmitter } from 'events';
import AxiosDigestAuth from '@koush/axios-digest-auth';
import https from 'https';

const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
})

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
    CellMotion,
    Detection,
    BinaryRingEvent,
    DigitalInputStart,
    DigitalInputStop,
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
        if (output.length === 0) {
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
    snapshotUrls = new Map<string, string>();
    rtspUrls = new Map<string, string>();
    profiles: Promise<any>;
    binaryStateEvent: string;
    digestAuth: AxiosDigestAuth;
    detections: Map<string, string>;

    constructor(public cam: any, username: string, password: string, public console: Console, binaryStateEvent: string) {
        this.binaryStateEvent = binaryStateEvent
        this.digestAuth = new AxiosDigestAuth({
            username,
            password,
        });
    }

    async reboot() {
        return new Promise((resolve, reject) => {
            this.cam.systemReboot((err: Error, data: any, xml: string) => {
                if (err) {
                    this.console.log('reboot error', err);
                    return reject(err);
                }

                resolve(data as string);
            });
        })
    }

    listenEvents() {
        const ret = new EventEmitter();

        this.cam.on('event', (event: any, xml: string) => {
            ret.emit('data', xml);

            const eventTopic = stripNamespaces(event.topic._);

            if (event.message.message.data && event.message.message.data.simpleItem) {
                const dataValue = event.message.message.data.simpleItem.$.Value;
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
                }
                // Reolink
                else if (eventTopic.includes('Visitor') && (dataValue === true || dataValue === false)) {
                    if (dataValue) {
                        ret.emit('event', OnvifEvent.BinaryStart)
                    }
                    else {
                        ret.emit('event', OnvifEvent.BinaryStop)
                    }
                }
                // Mobotix T26
                else if (eventTopic.includes('VideoSource/Alarm')) {
                    if (dataValue === "Ring" || dataValue === "CameraBellButton") {
                        ret.emit('event', OnvifEvent.BinaryRingEvent);
                    }
                }
                // else if (eventTopic.includes('DigitalInput')) {
                //     if (dataValue)
                //         ret.emit('event', OnvifEvent.BinaryStart)
                //     else
                //         ret.emit('event', OnvifEvent.BinaryStop)
                // }
                else if (this.binaryStateEvent && eventTopic.includes(this.binaryStateEvent)) {
                    if (dataValue)
                        ret.emit('event', OnvifEvent.BinaryStart)
                    else
                        ret.emit('event', OnvifEvent.BinaryStop)
                }
                else if (eventTopic.includes('RuleEngine/CellMotionDetector/Motion')) {
                    // unclear if the IsMotion false is indicative of motion stop?
                    if (event.message.message.data.simpleItem.$.Name === 'IsMotion' && dataValue) {
                        ret.emit('event', OnvifEvent.MotionBuggy);
                    }
                }
                else if (eventTopic.includes('RuleEngine/ObjectDetector')) {
                    if (dataValue) {
                        try {
                            const eventName = event.message.message.data.simpleItem.$.Name;
                            const className = this.detections.get(eventName);
                            this.console.log('object detected:', className);
                            ret.emit('event', OnvifEvent.Detection, className);
                        }
                        catch (e) {
                            this.console.warn('error parsing detection', e);
                        }
                    }
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

    async supportsEvents(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.cam.getCapabilities((err: Error, data: any, xml: string) => {
                if (err) {
                    this.console.log('supportsEvents error', err);
                    return reject(err);
                }
                if (!err && data.events && data.events.WSPullPointSupport && data.events.WSPullPointSupport === true) {
                    this.console.log('Camera supports WSPullPoint', xml);
                } else {
                    this.console.log('Camera does not show WSPullPoint support, but trying anyway', xml);
                }

                resolve(undefined);
            });
        })
    }

    async createSubscription(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.cam.createPullPointSubscription((err: Error, data: any, xml: string) => {
                if (err) {
                    this.console.log('createSubscription error', err);
                    return reject(err);
                }

                resolve(undefined);
            });
        })
    }

    unsubscribe() {
        return new Promise((resolve, reject) => {
            this.cam.unsubscribe((err: Error, data: any, xml: string) => {
                if (err) {
                    this.console.log('unsubscribe error', err);
                    return reject(err);
                }

                resolve(undefined);
            });
        })
    }

    async getEventTypes(): Promise<string[]> {
        if (this.detections)
            return [...this.detections.values()];

        return new Promise((resolve, reject) => {
            this.cam.getEventProperties((err, data, xml) => {
                if (err) {
                    this.console.log('getEventTypes error', err);
                    return reject(err);
                }

                this.console.log(xml);
                this.detections = new Map();
                try {

                    for (const [className, entry] of Object.entries(data.topicSet.ruleEngine.objectDetector) as any) {
                        try {
                            const eventName = entry.messageDescription.data.simpleItemDescription.$.Name;
                            this.detections.set(eventName, className);
                        }
                        catch (e) {
                        }
                    }
                }
                catch (e) {
                }

                resolve([...this.detections.values()]);
            });
        })
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

    async jpegSnapshot(profileToken?: string): Promise<Buffer | undefined> {
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

        const response = await this.digestAuth.request({
            method: 'GET',
            url: snapshotUri,
            responseType: 'arraybuffer',
            httpsAgent,
            timeout: 60000,
        });

        return Buffer.from(response.data);
    }

    getDeviceInformation(): Promise<any> {
        return promisify(cb => {
            this.cam.getDeviceInformation(cb);
        })
    }
}

export async function connectCameraAPI(ipAndPort: string, username: string, password: string, console: Console, binaryStateEvent: string) {
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
    return new OnvifCameraAPI(cam, username, password, console, binaryStateEvent);
}
