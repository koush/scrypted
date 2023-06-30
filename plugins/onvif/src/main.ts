import sdk, { AdoptDevice, Device, DeviceCreatorSettings, DeviceDiscovery, DeviceInformation, DiscoveredDevice, Intercom, MediaObject, MediaStreamOptions, ObjectDetectionTypes, ObjectDetector, ObjectsDetected, PanTiltZoom, PanTiltZoomCommand, PictureOptions, Reboot, ScryptedDeviceType, ScryptedInterface, ScryptedNativeId, Setting, Settings, SettingValue, VideoCamera, VideoCameraConfiguration } from "@scrypted/sdk";
import { AddressInfo } from "net";
import onvif from 'onvif';
import { Stream } from "stream";
import xml2js from 'xml2js';
import { Destroyable, RtspProvider, RtspSmartCamera, UrlMediaStreamOptions } from "../../rtsp/src/rtsp";
import { connectCameraAPI, OnvifCameraAPI, OnvifEvent } from "./onvif-api";
import { OnvifIntercom } from "./onvif-intercom";
import { OnvifPTZMixinProvider } from "./onvif-ptz";
import { listenEvents } from "./onvif-events";

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

class OnvifCamera extends RtspSmartCamera implements ObjectDetector, Intercom, VideoCameraConfiguration, Reboot {
    eventStream: Stream;
    client: OnvifCameraAPI;
    rtspMediaStreamOptions: Promise<UrlMediaStreamOptions[]>;
    intercom = new OnvifIntercom(this);

    constructor(nativeId: string, provider: RtspProvider) {
        super(nativeId, provider);

        this.updateDeviceInfo();
        this.updateDevice();
    }

    async reboot(): Promise<void> {
        const client = await this.getClient();
        await client.reboot();
    }

    async setVideoStreamOptions(options: MediaStreamOptions): Promise<void> {
        const client = await this.getClient();
        const profiles: any[] = await client.getProfiles();
        const profile = profiles.find(profile => profile.$.token === options.id);
        const configuration = profile.videoEncoderConfiguration;

        const videoOptions = options.video;

        switch (videoOptions.codec) {
            case 'h264':
                configuration.encoding = 'H264';

                if (videoOptions.idrIntervalMillis && videoOptions.fps) {
                    configuration.H264 ||= {};
                    configuration.H264.govLength = Math.floor(videoOptions.fps * videoOptions.idrIntervalMillis / 1000);
                }
                if (videoOptions.keyframeInterval) {
                    configuration.H264 ||= {};
                    configuration.H264.govLength = videoOptions.keyframeInterval;
                }
                if (videoOptions.profile) {
                    configuration.H264 ||= {};
                    configuration.H264.profile = videoOptions.profile;
                }
                break;
        }

        if (videoOptions.width && videoOptions.height) {
            configuration.resolution ||= {};
            configuration.resolution.width = videoOptions.width;
            configuration.resolution.height = videoOptions.height;
        }

        if (videoOptions?.bitrate) {
            configuration.rateControl ||= {};
            configuration.rateControl.bitrateLimit = Math.floor(videoOptions.bitrate / 1000);
        }
        if (videoOptions.fps) {
            configuration.rateControl ||= {};
            configuration.rateControl.frameRateLimit = videoOptions.fps;
            configuration.rateControl.encodingInterval = 1;
        }

        return new Promise((r, f) => {
            client.cam.setVideoEncoderConfiguration(configuration, (e: Error, result: any) => {
                if (e)
                    return f(e);

                r();
            })
        });
    }

    async updateDeviceInfo() {
        const ip = this.storage.getItem('ip');
        if (!ip)
            return;
        const client = await this.getClient();
        const onvifInfo = await client.getDeviceInformation().catch(() => { });

        const managementUrl = `http://${ip}`;
        let info = {
            ...this.info,
            managementUrl,
            ip,
        };
        if (onvifInfo) {
            info = {
                ...info,
                serialNumber: onvifInfo.serialNumber,
                manufacturer: onvifInfo.manufacturer,
                firmware: onvifInfo.firmwareVersion,
                model: onvifInfo.model,
            }
        }

        this.info = info;
    }

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
                                metadata: {
                                    videoId: videoEncoderConfiguration?.$?.token,
                                    audioId: audioEncoderConfiguration?.$?.token,
                                },
                                name: name,
                                container: 'rtsp',
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


    async listenEvents() {
        const client = await this.createClient();
        try {
            const eventTypes = await client.getEventTypes();
            if (eventTypes?.length && this.storage.getItem('onvifDetector') !== 'true') {
                this.storage.setItem('onvifDetector', 'true');
                this.updateDevice();
            }
        }
        catch (e) {
        }

        return listenEvents(this, client);
    }

    createClient() {
        return connectCameraAPI(this.getHttpAddress(), this.getUsername(), this.getPassword(), this.console, this.storage.getItem('onvifDoorbellEvent'));
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
        const isDoorbell = !!this.providedInterfaces?.includes(ScryptedInterface.BinarySensor);

        const ret: Setting[] = [
            ...await super.getOtherSettings(),
            {
                title: 'Onvif Doorbell',
                type: 'boolean',
                description: 'Enable if this device is a doorbell',
                key: 'onvifDoorbell',
                value: isDoorbell.toString(),
            },
            {
                title: 'Onvif Doorbell Event Name',
                type: 'string',
                description: 'Onvif event name to trigger the doorbell',
                key: "onvifDoorbellEvent",
                value: this.storage.getItem('onvifDoorbellEvent'),
                placeholder: 'EventName'
            },
        ];

        if (!isDoorbell) {
            ret.push(
                {
                    title: 'Two Way Audio',
                    type: 'boolean',
                    key: 'onvifTwoWay',
                    value: (!!this.providedInterfaces?.includes(ScryptedInterface.Intercom)).toString(),
                }
            )
        }

        return ret;
    }

    updateDevice() {
        const interfaces: string[] = [...this.provider.getInterfaces()];
        if (this.storage.getItem('onvifDetector') === 'true')
            interfaces.push(ScryptedInterface.ObjectDetector);
        const doorbell = this.storage.getItem('onvifDoorbell') === 'true';
        let type: ScryptedDeviceType;
        if (doorbell) {
            interfaces.push(ScryptedInterface.BinarySensor);
            type = ScryptedDeviceType.Doorbell;
        }

        const twoWay = this.storage.getItem('onvifTwoWay') === 'true';
        if (twoWay || doorbell)
            interfaces.push(ScryptedInterface.Intercom);

        this.provider.updateDevice(this.nativeId, this.name, interfaces, type);
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);
    }

    async putSetting(key: string, value: any) {
        this.client = undefined;
        this.rtspMediaStreamOptions = undefined;

        this.updateDeviceInfo();

        if (key !== 'onvifDoorbell' && key !== 'onvifTwoWay')
            return super.putSetting(key, value);

        this.storage.setItem(key, value);
        this.updateDevice();
    }

    async startIntercom(media: MediaObject) {
        const options = await this.getConstructedVideoStreamOptions();
        const stream = options[0];
        this.intercom.url = stream.url;
        return this.intercom.startIntercom(media);
    }

    async stopIntercom() {
        return this.intercom.stopIntercom();
    }
}

class OnvifProvider extends RtspProvider implements DeviceDiscovery {
    discoveredDevices = new Map<string, {
        device: Device;
        host: string;
        port: string;
        timeout: NodeJS.Timeout;
    }>();

    constructor(nativeId?: string) {
        super(nativeId);

        process.nextTick(() => {
            deviceManager.onDeviceDiscovered({
                name: 'ONVIF PTZ',
                type: ScryptedDeviceType.Builtin,
                nativeId: 'ptz',
                interfaces: [
                    ScryptedInterface.MixinProvider,
                ]
            })
        })

        onvif.Discovery.on('device', (cam: any, rinfo: AddressInfo, xml: any) => {
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
                    const urn = result['Envelope']['Body'][0]['ProbeMatches'][0]['ProbeMatch'][0]['EndpointReference'][0]['Address'][0].payload;
                    const xaddrs = result['Envelope']['Body'][0]['ProbeMatches'][0]['ProbeMatch'][0]['XAddrs'][0].payload;
                    const knownScopes = {
                        'onvif://www.onvif.org/name/': '',
                        'onvif://www.onvif.org/MAC/': '',
                        'onvif://www.onvif.org/hardware/': '',
                    };

                    this.console.log('discovered device payload', xml);
                    try {
                        let scopes = result['Envelope']['Body'][0]['ProbeMatches'][0]['ProbeMatch'][0]['Scopes'][0].payload;
                        const splitScopes = scopes.split(" ") as string[];

                        for (const scope of splitScopes) {
                            for (const known of Object.keys(knownScopes)) {
                                if (scope.startsWith(known)) {
                                    knownScopes[known] = decodeURIComponent(scope.substring(known.length));
                                }
                            }
                        }
                    }
                    catch (e) {
                    }

                    const name = knownScopes["onvif://www.onvif.org/name/"] || 'ONVIF Camera';
                    this.console.log('Discovery Reply from ' + rinfo.address + ' (' + name + ') (' + xaddrs + ') (' + urn + ')');

                    if (deviceManager.getNativeIds().includes(urn) || this.discoveredDevices.has(urn))
                        return;

                    const device: Device = {
                        name,
                        info: {
                            ip: rinfo.address,
                            mac: knownScopes["onvif://www.onvif.org/MAC/"] || undefined,
                            model: knownScopes['onvif://www.onvif.org/hardware/'] || undefined,
                        },
                        nativeId: urn,
                        type: ScryptedDeviceType.Camera,
                        interfaces: this.getInterfaces(),
                    };
                    const onvifUrl = new URL(xaddrs);
                    clearTimeout(this.discoveredDevices.get(urn)?.timeout);
                    this.discoveredDevices.set(urn, {
                        device,
                        host: rinfo.address,
                        port: onvifUrl.port,
                        timeout: setTimeout(() => {
                            this.discoveredDevices.delete(urn);
                        }, 5 * 60 * 1000),
                    });

                    this.onDeviceEvent(ScryptedInterface.DeviceDiscovery, await this.discoverDevices());

                    // const device = await this.getDevice(urn) as OnvifCamera;
                    // device.setIPAddress(rinfo.address);
                    // device.setHttpPortOverride(onvifUrl.port);
                    // this.log.a('Discovered ONVIF Camera. Complete setup by providing login credentials.');
                }
            );
        })
    }

    async getDevice(nativeId: string) {
        if (nativeId === 'ptz')
            return new OnvifPTZMixinProvider('ptz');
        return super.getDevice(nativeId);
    }

    getAdditionalInterfaces() {
        return [
            ScryptedInterface.Reboot,
            ScryptedInterface.Camera,
            ScryptedInterface.AudioSensor,
            ScryptedInterface.MotionSensor,
            ScryptedInterface.VideoCameraConfiguration,
        ];
    }

    createCamera(nativeId: string): OnvifCamera {
        return new OnvifCamera(nativeId, this);
    }

    async createDevice(settings: DeviceCreatorSettings, nativeId?: ScryptedNativeId): Promise<string> {
        const httpAddress = `${settings.ip}:${settings.httpPort || 80}`;
        let info: DeviceInformation;;

        const username = settings.username?.toString();
        const password = settings.password?.toString();
        const skipValidate = settings.skipValidate === 'true';
        let ptzCapabilities: string[];
        if (!skipValidate) {
            try {
                const api = await connectCameraAPI(httpAddress, username, password, this.console, undefined);
                const onvifInfo = await api.getDeviceInformation();

                info = {
                    serialNumber: onvifInfo.serialNumber,
                    manufacturer: onvifInfo.manufacturer,
                    firmware: onvifInfo.firmwareVersion,
                    model: onvifInfo.model,
                    managementUrl: `http://${httpAddress}`,
                }

                settings.newCamera = info.model;

                if (api.cam?.services?.find((s: any) => s.namespace === 'http://www.onvif.org/ver20/ptz/wsdl')) {
                    ptzCapabilities = [
                        'Pan',
                        'Tilt',
                    ];
                }
            }
            catch (e) {
                this.console.error('Error adding ONVIF camera', e);
                throw e;
            }
        }
        settings.newCamera ||= 'ONVIF Camera';

        nativeId = await super.createDevice(settings, nativeId);

        const device = await this.getDevice(nativeId) as OnvifCamera;
        device.info = info;
        device.putSetting('username', username);
        device.putSetting('password', password);
        device.setIPAddress(settings.ip?.toString());
        device.setHttpPortOverride(settings.httpPort?.toString());

        const intercom = new OnvifIntercom(device);
        try {
            intercom.url = (await device.getConstructedVideoStreamOptions())[0].url;
            if (await intercom.checkIntercom()) {
                device.putSetting('onvifTwoWay', 'true');
            }
        }
        catch (e) {
            this.console.warn("error while probing intercom", e);
        }
        finally {
            intercom.intercomClient?.client.destroy();
        }

        if (ptzCapabilities) {
            try {
                const rd = sdk.systemManager.getDeviceById(device.id);
                const ptz = await this.getDevice('ptz');
                rd.setMixins([...(rd.mixins || []), ptz.id]);
            }
            catch (e) {
            }
        }

        return nativeId;
    }

    async getCreateDeviceSettings(): Promise<Setting[]> {
        return [
            {
                key: 'username',
                title: 'Username',
            },
            {
                key: 'password',
                title: 'Password',
                type: 'password',
            },
            {
                key: 'ip',
                title: 'IP Address',
                placeholder: '192.168.2.222',
            },
            {
                key: 'httpPort',
                title: 'HTTP Port',
                description: 'Optional: Override the HTTP Port from the default value of 80',
                placeholder: '80',
            },
            {
                key: 'skipValidate',
                title: 'Skip Validation',
                description: 'Add the device without verifying the credentials and network settings.',
                type: 'boolean',
            }
        ]
    }

    async discoverDevices(scan?: boolean): Promise<DiscoveredDevice[]> {
        if (scan)
            onvif.Discovery.probe();
        return [...this.discoveredDevices.values()].map(d => ({
            ...d.device,
            description: d.host,
            settings: [
                {
                    key: 'username',
                    title: 'Username',
                },
                {
                    key: 'password',
                    title: 'Password',
                    type: 'password',
                },
            ]
        }));
    }

    async adoptDevice(adopt: AdoptDevice): Promise<string> {
        const entry = this.discoveredDevices.get(adopt.nativeId);
        this.onDeviceEvent(ScryptedInterface.DeviceDiscovery, await this.discoverDevices());
        if (!entry)
            throw new Error('device not found');
        adopt.settings.ip = entry.host;
        adopt.settings.httpPort = entry.port;
        await this.createDevice(adopt.settings, adopt.nativeId);
        this.discoveredDevices.delete(adopt.nativeId);
        const device = await this.getDevice(adopt.nativeId) as OnvifCamera;
        return device.id;
    }
}

export default OnvifProvider;
