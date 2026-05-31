import { AuthFetchCredentialState, authHttpFetch, HttpFetchOptions } from '@scrypted/common/src/http-auth-fetch';
import { VideoStreamConfiguration } from '@scrypted/sdk';
import { EventEmitter } from 'events';
import { Readable } from 'stream';

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
    credential: AuthFetchCredentialState;
    detections: Map<string, string>;

    constructor(public cam: any, username: string, password: string, public console: Console, binaryStateEvent: string) {
        this.binaryStateEvent = binaryStateEvent
        this.credential = {
            username,
            password,
        };
    }

    async request(urlOrOptions: string | URL | HttpFetchOptions<Readable>, body?: Readable) {
        const response = await authHttpFetch({
            ...typeof urlOrOptions !== 'string' && !(urlOrOptions instanceof URL) ? urlOrOptions : {
                url: urlOrOptions,
            },
            rejectUnauthorized: false,
            credential: this.credential,
            body,
        });
        return response;
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

            if (!event.message.message.data?.simpleItem?.$)
                return;

            const dataValue = event.message.message.data.simpleItem.$.Value;
            const eventTopic = stripNamespaces(event.topic._);

            ret.emit('onvifEvent', eventTopic, dataValue);

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
        });
        return ret;
    }

    async canConfigureEncoding() {
        const ret: any = await promisify(cb => this.cam.getMediaServiceCapabilities(cb));
        return !!ret.profileCapabilities;
    }

    async getVideoEncoderConfigurationOptions(profileToken: string, configurationToken: string): Promise<VideoStreamConfiguration> {
        const options: any = await promisify(cb => this.cam.getVideoEncoderConfigurationOptions({ profileToken }, cb));
        const codecs: string[] = [];
        if (options.H264)
            codecs.push('h264');
        if (options.H265)
            codecs.push('h265');

        let qualityRange: [number, number];
        const resolutions: [number, number][] = [];
        let fpsRange: [number, number];
        let keyframeIntervalRange: [number, number];
        const profiles: string[] = [];
        let bitrateRange: [number, number];

        const ensureArray = (value: any): any => {
            if (!Array.isArray(value))
                return [value];
            return value;
        };

        const H264 = options?.extension?.H264 || options?.H264;
        if (H264) {
            if (H264?.H264ProfilesSupported)
                profiles.push(...ensureArray(H264.H264ProfilesSupported).map(p => p.toLowerCase()));
            if (H264?.resolutionsAvailable)
                resolutions.push(...ensureArray(H264.resolutionsAvailable).map(r => [r.width, r.height]));
            if (H264?.frameRateRange?.min || H264?.frameRateRange?.max)
                fpsRange = [H264.frameRateRange.min, H264.frameRateRange.max];
            if (H264?.govLengthRange?.min || H264?.govLengthRange?.max)
                keyframeIntervalRange = [H264.govLengthRange.min, H264.govLengthRange.max];
            if (H264?.bitrateRange?.min || H264?.bitrateRange?.max)
                bitrateRange = [H264.bitrateRange.min, H264.bitrateRange.max];
        }
        if (options.qualityRange?.min || options?.qualityRange?.max)
            qualityRange = [options.qualityRange.min, options.qualityRange.max];

        // if (config?.)

        return {
            codecs,
            qualityRange,
            fpsRange,
            keyframeIntervalRange,
            resolutions,
            profiles,
            bitrateRange,
        }
    }

    async setVideoEncoderConfiguration(configuration: any) {
        return promisify(cb => this.cam.setVideoEncoderConfiguration(configuration, cb));
    }

    async setAudioEncoderConfiguration(configuration: any) {
        return promisify(cb => this.cam.setAudioEncoderConfiguration(configuration, cb));
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
                    if (data.topicSet.ruleEngine.objectDetector) {
                        for (const [className, entry] of Object.entries(data.topicSet.ruleEngine.objectDetector) as any) {
                            try {
                                const eventName = entry.messageDescription.data.simpleItemDescription.$.Name;
                                this.detections.set(eventName, className);
                            }
                            catch (e) {
                            }
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

    async jpegSnapshot(profileToken?: string, timeout = 10000): Promise<Buffer | undefined> {
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

        const response = await this.request({
            url: snapshotUri,
            timeout,
        });

        return response.body;
    }

    getDeviceInformation(): Promise<any> {
        return promisify(cb => {
            this.cam.getDeviceInformation(cb);
        })
    }

    async getOSDs(): Promise<any> {
        // this function accept video token but why?
        return promisify(cb => {
            this.cam.getOSDs(cb);
        });
    }

    async setOSD(osd: any) {
        return promisify(cb => {
            this.cam.setOSD(osd, cb);
        });
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
