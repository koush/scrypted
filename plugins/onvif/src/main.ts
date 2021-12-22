import sdk, { MediaObject, ScryptedInterface, Setting, ScryptedDeviceType, PictureOptions, VideoCamera, DeviceDiscovery, ObjectDetection, ObjectDetector, ObjectDetectionTypes, ObjectsDetected } from "@scrypted/sdk";
import { EventEmitter, Stream } from "stream";
import { RtspSmartCamera, RtspProvider, Destroyable, UrlMediaStreamOptions } from "../../rtsp/src/rtsp";
import { connectCameraAPI, OnvifCameraAPI, OnvifEvent } from "./onvif-api";
import xml2js from 'xml2js';
import onvif from 'onvif';

const { mediaManager, systemManager, deviceManager } = sdk;

function computeInterval(fps: number, govLength: number) {
    if (!fps || !govLength)
        return;
    return govLength / fps * 1000;
}

function computeBitrate(bitrate: number) {
    if (!bitrate)
        return;
    return bitrate * 1000;
}

function convertAudioCodec(codec: string) {
    if (codec?.toLowerCase()?.includes('mp4a'))
        return 'aac';
    if (codec?.toLowerCase()?.includes('aac'))
        return 'aac';
    return codec?.toLowerCase();
}

class OnvifCamera extends RtspSmartCamera implements ObjectDetector {
    eventStream: Stream;
    client: OnvifCameraAPI;
    rtspMediaStreamOptions: Promise<UrlMediaStreamOptions[]>;

    getDetectionInput(detectionId: any, eventId?: any): Promise<MediaObject> {
        throw new Error("Method not implemented.");
    }

    async getObjectTypes(): Promise<ObjectDetectionTypes> {
        const client = await this.getClient();
        const classes = await client.getEventTypes();
        return {
            classes,
        }
    }

    async getPictureOptions(): Promise<PictureOptions[]> {
        try {
            const vsos = await this.getVideoStreamOptions();
            const ret = vsos.map(({ id, name, video }) => ({
                id,
                name,
                // onvif doesn't actually specify the snapshot dimensions for a profile.
                // it may just send whatever.
                picture: {
                    width: video?.width,
                    height: video?.height,
                }
            }));
            return ret;
        }
        catch (e) {
        }
    }

    async takeSmartCameraPicture(options?: PictureOptions): Promise<MediaObject> {
        const client = await this.getClient();
        let snapshot: Buffer;
        let id = options?.id;

        if (!id) {
            const vsos = await this.getVideoStreamOptions();
            const vso = this.getDefaultStream(vsos);
            id = vso?.id;
        }

        snapshot = await client.jpegSnapshot(id);

        // it is possible that onvif does not support snapshots, in which case return the video stream
        if (!snapshot) {
            // grab the real device rather than the using this.getVideoStream
            // so we can take advantage of the rebroadcast plugin if available.
            const realDevice = systemManager.getDeviceById<VideoCamera>(this.id);
            return realDevice.getVideoStream({
                id,
            });

            // todo: this is bad. just disable camera interface altogether.
        }
        return mediaManager.createMediaObject(snapshot, 'image/jpeg');
    }

    async getConstructedVideoStreamOptions(): Promise<UrlMediaStreamOptions[]> {
        if (!this.rtspMediaStreamOptions) {
            this.rtspMediaStreamOptions = new Promise(async (resolve) => {
                try {
                    const client = await this.getClient();
                    const profiles: any[] = await client.getProfiles();
                    const ret: UrlMediaStreamOptions[] = [];
                    for (const { $, name, videoEncoderConfiguration, audioEncoderConfiguration } of profiles) {
                        try {
                            ret.push({
                                id: $.token,
                                name: name,
                                url: await client.getStreamUrl($.token),
                                video: {
                                    fps: videoEncoderConfiguration?.rateControl?.frameRateLimit,
                                    bitrate: computeBitrate(videoEncoderConfiguration?.rateControl?.bitrateLimit),
                                    width: videoEncoderConfiguration?.resolution?.width,
                                    height: videoEncoderConfiguration?.resolution?.height,
                                    codec: videoEncoderConfiguration?.encoding?.toLowerCase(),
                                    idrIntervalMillis: computeInterval(videoEncoderConfiguration?.rateControl?.frameRateLimit,
                                        videoEncoderConfiguration?.$.GovLength),
                                },
                                audio: this.isAudioDisabled() ? null : {
                                    bitrate: computeBitrate(audioEncoderConfiguration?.bitrate),
                                    codec: convertAudioCodec(audioEncoderConfiguration?.encoding),
                                }
                            })
                        }
                        catch (e) {
                            this.console.error('error retrieving onvif profile', $.token, e);
                        }
                    }

                    if (!ret.length)
                        throw new Error('onvif camera had no profiles.');

                    resolve(ret);
                }
                catch (e) {
                    this.rtspMediaStreamOptions = undefined;
                    this.console.error('error retrieving onvif profiles', e);
                    resolve(undefined);
                }
            })
        }

        return this.rtspMediaStreamOptions;
    }


    listenEvents(): EventEmitter & Destroyable {
        let motionTimeout: NodeJS.Timeout;
        const ret: any = new EventEmitter();

        (async () => {
            const client = await this.createClient();
            try {
                await client.supportsEvents();
            }
            catch (e) {
            }
            try {
                await client.createSubscription();
            }
            catch (e) {
                ret.emit('error', e);
                return;
            }

            try {
                const eventTypes = await client.getEventTypes();
                if (eventTypes?.length && this.storage.getItem('onvifDetector') !== 'true') {
                    this.storage.setItem('onvifDetector', 'true');
                    this.updateDevice();
                }
            }
            catch (e) {
            }
            this.console.log('listening events');
            const events = client.listenEvents();
            events.on('event', (event, className) => {
                if (event === OnvifEvent.MotionBuggy) {
                    this.motionDetected = true;
                    clearTimeout(motionTimeout);
                    motionTimeout = setTimeout(() => this.motionDetected = false, 30000);
                    return;
                }

                if (event === OnvifEvent.MotionStart)
                    this.motionDetected = true;
                else if (event === OnvifEvent.MotionStop)
                    this.motionDetected = false;
                else if (event === OnvifEvent.AudioStart)
                    this.audioDetected = true;
                else if (event === OnvifEvent.AudioStop)
                    this.audioDetected = false;
                else if (event === OnvifEvent.BinaryStart)
                    this.binaryState = true;
                else if (event === OnvifEvent.BinaryStop)
                    this.binaryState = false;
                else if (event === OnvifEvent.Detection) {
                    const d: ObjectsDetected = {
                        timestamp: Date.now(),
                        detections: [
                            {
                                score: undefined,
                                className,
                            }
                        ]
                    }
                    this.onDeviceEvent(ScryptedInterface.ObjectDetector, d);
                }
            })
        })();
        ret.destroy = () => {
        };
        return ret;
    }

    createClient() {
        return connectCameraAPI(this.getHttpAddress(), this.getUsername(), this.getPassword(), this.console, this.storage.getItem('onvifDoorbellEvent'), !!this.storage.getItem('debug'));
    }

    async getClient() {
        if (!this.client)
            this.client = await this.createClient();
        return this.client;
    }

    showRtspUrlOverride() {
        return false;
    }

    showRtspPortOverride() {
        return false;
    }

    showHttpPortOverride() {
        return true;
    }

    showSnapshotUrlOverride() {
        return false;
    }

    async getOtherSettings(): Promise<Setting[]> {
        return [
            {
                title: 'Onvif Doorbell',
                type: 'boolean',
                description: 'Enable if this device is a doorbell',
                key: 'onvifDoorbell',
                value: (!!this.providedInterfaces?.includes(ScryptedInterface.BinarySensor)).toString(),
            },
            {
                title: 'Onvif Doorbell Event Name',
                type: 'string',
                description: 'Onvif event name to trigger the doorbell',
                key: "onvifDoorbellEvent",
                value: this.storage.getItem('onvifDoorbellEvent'),
                placeholder: 'EventName'
            }
        ]
    }

    updateDevice() {
        const interfaces: string[] = [...this.provider.getInterfaces()];
        if (this.storage.getItem('onvifDetector') === 'true')
            interfaces.push(ScryptedInterface.ObjectDetector);
        const doorbell = this.storage.getItem('onvifDoorbell');
        if (doorbell === 'true')
            this.provider.updateDevice(this.nativeId, this.name, [...interfaces, ScryptedInterface.BinarySensor], ScryptedDeviceType.Doorbell)
        else
            this.provider.updateDevice(this.nativeId, this.name, interfaces);
    }

    async putSetting(key: string, value: string) {
        this.client = undefined;
        this.rtspMediaStreamOptions = undefined;

        if (key !== 'onvifDoorbell')
            return super.putSetting(key, value);

        this.storage.setItem(key, value);
        this.updateDevice();
    }
}

class OnvifProvider extends RtspProvider implements DeviceDiscovery {
    constructor(nativeId?: string) {
        super(nativeId);

        this.discoverDevices(10000);

        onvif.Discovery.on('device', (cam: any, rinfo: any, xml: any) => {
            // Function will be called as soon as the NVT responses

            // Parsing of Discovery responses taken from my ONVIF-Audit project, part of the 2018 ONVIF Open Source Challenge
            // Filter out xml name spaces
            xml = xml.replace(/xmlns([^=]*?)=(".*?")/g, '');

            let parser = new xml2js.Parser({
                attrkey: 'attr',
                charkey: 'payload',                // this ensures the payload is called .payload regardless of whether the XML Tags have Attributes or not
                explicitCharkey: true,
                tagNameProcessors: [xml2js.processors.stripPrefix]   // strip namespace eg tt:Data -> Data
            });
            parser.parseString(xml,
                async (err: Error, result: any) => {
                    if (err) {
                        this.console.error('discovery error', err);
                        return;
                    }
                    let urn = result['Envelope']['Body'][0]['ProbeMatches'][0]['ProbeMatch'][0]['EndpointReference'][0]['Address'][0].payload;
                    let xaddrs = result['Envelope']['Body'][0]['ProbeMatches'][0]['ProbeMatch'][0]['XAddrs'][0].payload;
                    let scopes = result['Envelope']['Body'][0]['ProbeMatches'][0]['ProbeMatch'][0]['Scopes'][0].payload;
                    scopes = scopes.split(" ");

                    let hardware = "";
                    let name = "";
                    for (let i = 0; i < scopes.length; i++) {
                        if (scopes[i].includes('onvif://www.onvif.org/name')) { name = decodeURI(scopes[i].substring(27)); }
                        if (scopes[i].includes('onvif://www.onvif.org/hardware')) { hardware = decodeURI(scopes[i].substring(31)); }
                    }
                    let msg = 'Discovery Reply from ' + rinfo.address + ' (' + name + ') (' + hardware + ') (' + xaddrs + ') (' + urn + ')';
                    this.console.log(msg);

                    const isNew = !deviceManager.getNativeIds().includes(urn);
                    if (!isNew)
                        return;

                    await deviceManager.onDeviceDiscovered({
                        name,
                        nativeId: urn,
                        type: ScryptedDeviceType.Camera,
                        interfaces: this.getInterfaces(),
                    });
                    const device = await this.getDevice(urn) as OnvifCamera;
                    const onvifUrl = new URL(xaddrs)
                    device.setIPAddress(rinfo.address);
                    device.setHttpPortOverride(onvifUrl.port);
                    this.log.a('Discovered ONVIF Camera. Complete setup by providing login credentials.');
                }
            );
        })
    }

    getAdditionalInterfaces() {
        return [
            ScryptedInterface.Camera,
            ScryptedInterface.AudioSensor,
            ScryptedInterface.MotionSensor,
        ];
    }

    createCamera(nativeId: string): OnvifCamera {
        return new OnvifCamera(nativeId, this);
    }

    async discoverDevices(duration: number) {
        const ad = this.storage.getItem('autodiscovery');
        const cameraCount = deviceManager.getNativeIds().filter(nid => !!nid).length
        if (ad == null) {
            // no auto discovery state yet, but disable it if legacy cameras are found.
            if (cameraCount) {
                this.storage.setItem('autodiscovery', 'false');
                this.console.log('autodiscovery bypassed. legacy cameras already exist.');
                return;
            }

            this.storage.setItem('autodiscovery', 'true');
        }
        else if (ad === 'false') {
            // auto discovery is disabled, but maybe we can reenable it.
            if (!cameraCount) {
                this.console.log('autodiscovery reenabled, no cameras found');
                this.storage.setItem('autodiscovery', 'true');
            }
            else {
                this.console.log('autodiscovery bypassed. running in legacy mode. set it to "true" in storage to override this (and possibly duplicate cameras). Or delete all your cameras and reload the plugin.');
                return;
            }
        }

        onvif.Discovery.probe();
    }
}

export default new OnvifProvider();
