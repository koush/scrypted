import { automaticallyConfigureSettings, checkPluginNeedsAutoConfigure } from "@scrypted/common/src/autoconfigure-codecs";
import sdk, { Camera, Device, DeviceCreatorSettings, DeviceInformation, FFmpegInput, Intercom, MediaObject, MediaStreamOptions, ObjectDetectionResult, ObjectDetectionTypes, ObjectDetector, ObjectsDetected, PanTiltZoom, PanTiltZoomCommand, Reboot, RequestPictureOptions, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, ScryptedNativeId, Setting, VideoCameraConfiguration, VideoTextOverlay, VideoTextOverlays } from "@scrypted/sdk";
import crypto from 'crypto';
import { PassThrough } from "stream";
import xml2js from 'xml2js';
import { RtpPacket } from '../../../external/werift/packages/rtp/src/rtp/rtp';
import { OnvifIntercom } from "../../onvif/src/onvif-intercom";
import { createRtspMediaStreamOptions, RtspProvider, RtspSmartCamera, UrlMediaStreamOptions } from "../../rtsp/src/rtsp";
import { startRtpForwarderProcess } from '../../webrtc/src/rtp-forwarders';
import { HikvisionAPI } from "./hikvision-api-channels";
import { autoconfigureSettings, hikvisionAutoConfigureSettings } from "./hikvision-autoconfigure";
import { detectionMap, HikvisionCameraAPI, HikvisionCameraEvent } from "./hikvision-camera-api";
import { HikvisionSupplementalLight } from "./supplemental-light";
import { HikvisionAlarmSwitch } from "./alarm-switch";

const rtspChannelSetting: Setting = {
    subgroup: 'Advanced',
    key: 'rtspChannel',
    title: 'Channel Number',
    description: "Optional: The channel number to use for snapshots. E.g., 101, 201, etc. The camera portion, e.g., 1, 2, etc, will be used to construct the RTSP stream.",
    placeholder: '101',
};

const { mediaManager } = sdk;

function channelToCameraNumber(channel: string) {
    if (!channel)
        return;
    return channel.substring(0, channel.length - 2);
}

export class HikvisionCamera extends RtspSmartCamera implements Camera, Intercom, Reboot, ObjectDetector, VideoCameraConfiguration, VideoTextOverlays, PanTiltZoom {
    detectedChannels: Promise<Map<string, MediaStreamOptions>>;
    onvifIntercom = new OnvifIntercom(this);
    activeIntercom: Awaited<ReturnType<typeof startRtpForwarderProcess>>;
    hasSmartDetection: boolean;
    supplementLight: HikvisionSupplementalLight;
    alarm: HikvisionAlarmSwitch;
    ptzPresets: string[];

    client: HikvisionAPI;

    constructor(nativeId: string, provider: RtspProvider) {
        super(nativeId, provider);

        this.hasSmartDetection = this.storage.getItem('hasSmartDetection') === 'true';
        this.ptzPresets = JSON.parse(this.storage.getItem('storedPtzPresets') ?? '[]');

        this.updateDevice();
        this.updateDeviceInfo();
        this.reportDevices();

        if (this.interfaces.includes(ScryptedInterface.PanTiltZoom)) {
            const ptzCapabilities = JSON.parse(this.storage.getItem('ptzCapabilities') ?? '[]');
            this.fetchPtzPresets().catch(this.console.error);
            this.updatePtzCaps(ptzCapabilities);
        }
    }

    async getVideoTextOverlays(): Promise<Record<string, VideoTextOverlay>> {
        const client = this.getClient();
        const overlays = await client.getOverlay();
        const ret: Record<string, VideoTextOverlay> = {};

        for (const to of overlays.json.VideoOverlay.TextOverlayList?.[0]?.TextOverlay) {
            ret[to.id[0]] = {
                text: to.displayText[0],
            }
        }
        return ret;
    }

    async setVideoTextOverlay(id: string, value: VideoTextOverlay): Promise<void> {
        const client = this.getClient();
        const overlays = await client.getOverlay();
        // find the overlay by id
        const overlay = overlays.json.VideoOverlay.TextOverlayList?.[0]?.TextOverlay.find(o => o.id[0] === id);
        overlay.enabled[0] = value.text ? 'true' : 'false';
        if (typeof value.text === 'string')
            overlay.displayText = [value.text];
        client.updateOverlayText(id, {
            TextOverlay: overlay,
        });
    }

    async reboot() {
        const client = this.getClient();
        await client.reboot();
    }

    async setVideoStreamOptions(options: MediaStreamOptions) {
        let vsos = await this.getVideoStreamOptions();
        const index = vsos.findIndex(vso => vso.id === options.id);
        const client = this.getClient();
        return client.configureCodecs(this.getCameraNumber() || '1', (index + 1).toString().padStart(2, '0'), options)
    }

    async updateDeviceInfo() {
        const ip = this.storage.getItem('ip');
        if (!ip)
            return;
        const managementUrl = `http://${ip}`;
        const info: DeviceInformation = {
            ...this.info,
            managementUrl,
            ip,
            manufacturer: 'Hikvision',
        };
        const client = this.getClient();
        const deviceInfo = await client.getDeviceInfo().catch(() => { });
        if (deviceInfo) {
            info.model = deviceInfo.deviceModel;
            info.mac = deviceInfo.macAddress;
            info.firmware = deviceInfo.firmwareVersion;
            info.serialNumber = deviceInfo.serialNumber;
        }
        this.info = info;
    }

    async ptzCommand(command: PanTiltZoomCommand): Promise<void> {
        const client = this.getClient();
        await client.ptzCommand(command);
    }

    async listenEvents() {
        let motionTimeout: NodeJS.Timeout;
        const api = (this.provider as HikvisionProvider).createSharedClient(this.getHttpAddress(), this.getUsername(), this.getPassword());
        const events = await api.listenEvents();

        let ignoreCameraNumber: boolean;

        const motionTimeoutDuration = 20000;

        // check if the camera+channel field is in use, and filter events.
        const checkCameraNumber = async (cameraNumber: string) => {
            // check if the camera+channel field is in use, and filter events.
            if (this.getRtspChannel()) {
                // it is possible to set it up to use a camera number
                // on an nvr IP (which gives RTSP urls through the NVR), but then use a http port
                // that gives a filtered event stream from only that camera.
                // this this case, the camera numbers will not
                // match as they will be always be "1".
                // to detect that a camera specific endpoint is being used
                // can look at the channel ids, and see if that camera number is found.
                // this is different from the use case where the NVR or camera
                // is using a port other than 80 (the default).
                // could add a setting to have the user explicitly denote nvr usage
                // but that is error prone.
                const userCameraNumber = this.getCameraNumber();
                if (ignoreCameraNumber === undefined && this.detectedChannels) {
                    const channelIds = (await this.detectedChannels).keys();
                    ignoreCameraNumber = true;
                    for (const id of channelIds) {
                        if (channelToCameraNumber(id) === userCameraNumber) {
                            ignoreCameraNumber = false;
                            break;
                        }
                    }
                }

                if (!ignoreCameraNumber && cameraNumber !== userCameraNumber) {
                    // this.console.error(`### Skipping motion event ${cameraNumber} != ${this.getCameraNumber()}`);
                    return false;
                }
            }

            return true;
        };

        events.on('event', async (event: HikvisionCameraEvent, cameraNumber: string, inactive: boolean) => {
            if (event === HikvisionCameraEvent.MotionDetected
                || event === HikvisionCameraEvent.LineDetection
                || event === HikvisionCameraEvent.RegionEntrance
                || event === HikvisionCameraEvent.RegionExit
                || event === HikvisionCameraEvent.FieldDetection) {

                if (!await checkCameraNumber(cameraNumber))
                    return;

                this.motionDetected = true;
                clearTimeout(motionTimeout);
                // motion seems to be on a 1 second pulse
                motionTimeout = setTimeout(() => {
                    this.motionDetected = false;
                }, motionTimeoutDuration);
            }
        });

        let inputDimensions: [number, number];

        events.on('smart', async (data: string, image: Buffer) => {
            if (!this.hasSmartDetection) {
                this.hasSmartDetection = true;
                this.storage.setItem('hasSmartDetection', 'true');
                this.updateDevice();
            }

            const xml = await xml2js.parseStringPromise(data);


            const [channelId] = xml.EventNotificationAlert.channelID || xml.EventNotificationAlert.dynChannelID;
            if (!await checkCameraNumber(channelId)) {
                this.console.warn('chann fail')
                return;
            }

            const now = Date.now();
            let detections: ObjectDetectionResult[] = xml.EventNotificationAlert?.DetectionRegionList?.map(region => {
                const name = region?.DetectionRegionEntry?.[0]?.detectionTarget?.name;
                if (!name)
                    return;
                return {
                    score: 1,
                    className: detectionMap[name] || name,
                    // boundingBox: [
                    //     parseInt(X),
                    //     parseInt(Y),
                    //     parseInt(width),
                    //     parseInt(height),
                    // ],
                    // movement: {
                    //     moving: true,
                    //     firstSeen: now,
                    //     lastSeen: now,
                    // }
                } as ObjectDetectionResult;
            });

            detections = detections?.filter(d => d);
            if (!detections?.length)
                return;

            // if (inputDimensions === undefined && loadSharp()) {
            //     try {
            //         const { image: i, metadata } = await loadVipsMetadata(image);
            //         i.destroy();
            //         inputDimensions = [metadata.width, metadata.height];
            //     }
            //     catch (e) {
            //         inputDimensions = null;
            //     }
            //     finally {
            //     }
            // }

            let detectionId: string;
            if (image) {
                detectionId = crypto.randomBytes(4).toString('hex');
                this.recentDetections.set(detectionId, image);
                setTimeout(() => this.recentDetections.delete(detectionId), 10000);
            }

            const detected: ObjectsDetected = {
                inputDimensions,
                detectionId,
                timestamp: now,
                detections,
            };

            this.onDeviceEvent(ScryptedInterface.ObjectDetector, detected);
        });

        return events;
    }

    recentDetections = new Map<string, Buffer>();

    async getDetectionInput(detectionId: string, eventId?: any): Promise<MediaObject> {
        const image = this.recentDetections.get(detectionId);
        if (!image)
            return;
        return mediaManager.createMediaObject(image, 'image/jpeg');
    }

    async getObjectTypes(): Promise<ObjectDetectionTypes> {
        return {
            classes: [
                ...Object.values(detectionMap),
            ]
        }
    }

    createClient(): HikvisionAPI {
        return new HikvisionCameraAPI(this.getHttpAddress(), this.getUsername(), this.getPassword(), this.console);
    }

    getClient() {
        if (!this.client)
            this.client = this.createClient();
        return this.client;
    }

    async takeSmartCameraPicture(options?: RequestPictureOptions): Promise<MediaObject> {
        const api = this.getClient();
        return mediaManager.createMediaObject(await api.jpegSnapshot(this.getRtspChannel(), options?.timeout), 'image/jpeg');
    }

    async getRtspUrlSettings(): Promise<Setting[]> {
        const ret = await super.getRtspUrlSettings();

        ret.push(
            {
                subgroup: 'Advanced',
                key: 'rtspUrlParams',
                title: 'RTSP URL Parameters Override',
                description: "Optional: Override the RTSP URL parameters. E.g.: ?transportmode=unicast",
                placeholder: this.getRtspUrlParams(),
                value: this.storage.getItem('rtspUrlParams'),
            },
        );
        return ret;
    }

    async getUrlSettings(): Promise<Setting[]> {
        const rtspSetting = {
            ...rtspChannelSetting,
            subgroup: 'Advanced',
            value: this.storage.getItem('rtspChannel'),
        };

        return [
            rtspSetting,
            ...await super.getUrlSettings(),
        ]
    }

    getRtspChannel() {
        return this.storage.getItem('rtspChannel');
    }

    getCameraNumber() {
        return channelToCameraNumber(this.getRtspChannel());
    }

    getRtspUrlParams() {
        return this.storage.getItem('rtspUrlParams') || '?transportmode=unicast';
    }

    async isOld() {
        const client = this.getClient();
        let isOld: boolean;
        if (this.storage.getItem('isOld')) {
            isOld = this.storage.getItem('isOld') === 'true';
        }
        else {
            isOld = await client.checkIsOldModel();
            this.storage.setItem('isOld', isOld?.toString());
        }
        return isOld;
    }

    async getConstructedVideoStreamOptions(): Promise<UrlMediaStreamOptions[]> {
        if (!this.detectedChannels) {
            const client = this.getClient();
            this.detectedChannels = (async () => {
                const isOld = await this.isOld();

                const defaultMap = new Map<string, MediaStreamOptions>();
                const camNumber = this.getCameraNumber() || '1';
                defaultMap.set(camNumber + '01', undefined);
                defaultMap.set(camNumber + '02', undefined);

                if (isOld) {
                    this.console.error('Old NVR. Defaulting to two camera configuration');
                    return defaultMap;
                }

                try {
                    let channels: MediaStreamOptions[];
                    try {
                        channels = await client.getCodecs(camNumber);
                        this.storage.setItem('channelsJSON', JSON.stringify(channels));
                    }
                    catch (e) {
                        const raw = this.storage.getItem('channelsJSON');
                        if (!raw)
                            throw e;
                        channels = JSON.parse(raw);
                    }
                    const ret = new Map<string, MediaStreamOptions>();
                    for (const streamingChannel of channels) {
                        const channel = streamingChannel.id;
                        ret.set(channel, streamingChannel);
                    }

                    return ret;
                }
                catch (e) {
                    this.console.error('error retrieving channel ids', e);
                    this.detectedChannels = undefined;
                    return defaultMap;
                }
            })();
        }
        const detectedChannels = await this.detectedChannels;
        const params = this.getRtspUrlParams() || '?transportmode=unicast';

        // due to being able to override the channel number, and NVR providing per channel port access,
        // do not actually use these channel ids, and just use it to determine the number of channels
        // available for a camera.
        const ret = [];
        let index = 0;
        const cameraNumber = this.getCameraNumber();
        for (const [id, channel] of detectedChannels.entries()) {
            if (cameraNumber && channelToCameraNumber(id) !== cameraNumber)
                continue;
            const mso = createRtspMediaStreamOptions(`rtsp://${this.getRtspAddress()}/ISAPI/Streaming/channels/${id}/${params}`, index++);
            Object.assign(mso.video, channel?.video);
            mso.tool = 'scrypted';
            ret.push(mso);
        }

        return ret;
    }

    showRtspUrlOverride() {
        return false;
    }

    updateDevice() {
        const doorbellType = this.storage.getItem('doorbellType');
        const isDoorbell = doorbellType === 'true';

        const twoWayAudio = this.storage.getItem('twoWayAudio') === 'true'
            || this.storage.getItem('twoWayAudio') === 'ONVIF'
            || this.storage.getItem('twoWayAudio') === 'Hikvision';

        const providedDevices = JSON.parse(this.storage.getItem('providedDevices') || '[]') as string[];
        const ptzCapabilities = JSON.parse(this.storage.getItem('ptzCapabilities') || '[]') as string[];

        const interfaces = this.provider.getInterfaces();
        let type: ScryptedDeviceType = undefined;
        if (isDoorbell) {
            type = ScryptedDeviceType.Doorbell;
            interfaces.push(ScryptedInterface.BinarySensor)
        }
        if (isDoorbell || twoWayAudio) {
            interfaces.push(ScryptedInterface.Intercom);
        }

        if (this.hasSmartDetection)
            interfaces.push(ScryptedInterface.ObjectDetector);

        if (!!providedDevices?.length) {
            interfaces.push(ScryptedInterface.DeviceProvider);
        }

        if (!!ptzCapabilities?.length) {
            interfaces.push(ScryptedInterface.PanTiltZoom);
        }

        this.provider.updateDevice(this.nativeId, this.name, interfaces, type);
    }

    async fetchPtzPresets() {
        try {
            const client = this.getClient();
            const cameraPresets: string[] = [];
            const presets = await client.getPresets();

            const allPresets = presets.json?.PTZPresetList?.PTZPreset ?? [];
            for (const to of allPresets) {
                if (to.enabled?.[0] === 'true') {
                    cameraPresets.push(`${to.id?.[0]}=${to.presetName?.[0]}`);
                }
            }

            this.storage.setItem('storedPtzPresets', JSON.stringify(cameraPresets));
            this.ptzPresets = cameraPresets;
        } catch (e) {
            this.console.error('Error in fetchPtzPresets', e);
            this.ptzPresets = [];
        }
    }

    async updatePtzCaps(cameraPtzCapabilities: string[]) {
        this.ptzCapabilities = {
            ...this.ptzCapabilities,
            pan: cameraPtzCapabilities?.includes('Pan'),
            tilt: cameraPtzCapabilities?.includes('Tilt'),
            zoom: cameraPtzCapabilities?.includes('Zoom'),
        }
    }

    async updatePtzPresets(ptzPresets: string[]) {
        const presets: Record<string, string> = {};

        ptzPresets.forEach(preset => {
            const parts = preset.split('=');
            if (parts.length === 2) {
                presets[parts[0]] = parts[1];
            }
        });

        this.ptzCapabilities = {
            ...this.ptzCapabilities,
            presets
        };
    }

    async putSetting(key: string, value: string | string[]) {
        if (key === automaticallyConfigureSettings.key) {
            const client = this.getClient();
            autoconfigureSettings(client, this.getCameraNumber() || '1')
                .then(() => {
                    this.log.a('Successfully configured settings.');
                })
                .catch(e => {
                    this.log.a('There was an error automatically configuring settings. More information can be viewed in the console.');
                    this.console.error('error autoconfiguring', e);
                });
            return;
        } else if (key === 'ptzPresets') {
            await this.updatePtzPresets(value as string[]);
        } else if (key === 'ptzCapabilities' && !!value?.length) {
            await this.fetchPtzPresets();
            this.updatePtzCaps(value as string[]);
        }

        this.client = undefined;
        this.detectedChannels = undefined;
        super.putSetting(key, typeof value === 'string' ? value : JSON.stringify(value));

        this.updateDevice();
        this.updateDeviceInfo();
        this.reportDevices();
    }

    async getOtherSettings(): Promise<Setting[]> {
        const ret = await super.getOtherSettings();

        const doorbellType = this.storage.getItem('doorbellType');
        const isDoorbell = doorbellType === 'true';

        let twoWayAudio = this.storage.getItem('twoWayAudio');

        const choices = [
            'Hikvision',
            'ONVIF',
        ];

        if (!isDoorbell)
            choices.unshift('None');

        twoWayAudio = choices.find(c => c === twoWayAudio);

        if (!twoWayAudio)
            twoWayAudio = isDoorbell ? 'Hikvision' : 'None';

        const providedDevices = JSON.parse(this.storage.getItem('providedDevices') || '[]') as string[];
        const ptzCapabilities = JSON.parse(this.storage.getItem('ptzCapabilities') || '[]') as string[];

        ret.push(
            {
                subgroup: 'Advanced',
                title: 'Doorbell',
                type: 'boolean',
                description: 'This device is a Hikvision doorbell.',
                value: isDoorbell,
                key: 'doorbellType',
            },
            {
                subgroup: 'Advanced',
                title: 'Two Way Audio',
                value: twoWayAudio,
                key: 'twoWayAudio',
                description: 'Hikvision cameras may support both Hikvision and ONVIF two way audio protocols. ONVIF generally performs better when supported.',
                choices,
            },
            {
                key: 'providedDevices',
                subgroup: 'Advanced',
                title: 'Provided devices',
                value: providedDevices,
                choices: [
                    'Alarm',
                    'SupplementLight',
                ],
                multiple: true,
            },
            {
                key: 'ptzCapabilities',
                subgroup: 'Advanced',
                value: ptzCapabilities,
                title: 'PTZ Capabilities',
                choices: [
                    'Pan',
                    'Tilt',
                    'Zoom',
                ],
                multiple: true,
            },
        );

        if (this.interfaces.includes(ScryptedInterface.PanTiltZoom)) {
            const ptzPresets = JSON.parse(this.storage.getItem('ptzPresets') || '[]');
            ret.push(
                {
                    key: 'ptzPresets',
                    subgroup: 'Advanced',
                    value: ptzPresets,
                    title: 'Presets',
                    description: 'PTZ Presets in the format "id=name". Where id is the PTZ Preset identifier and name is a friendly name.',
                    multiple: true,
                    combobox: true,
                    choices: this.ptzPresets,
                }
            );
        }

        const ac = {
            ...automaticallyConfigureSettings,
            subgroup: 'Advanced',
        };
        ac.type = 'button';
        ret.push(ac);
        ret.push({
            ...hikvisionAutoConfigureSettings,
            subgroup: 'Advanced',
        });

        return ret;
    }

    reportDevices() {
        const providedDevices = JSON.parse(this.storage.getItem('providedDevices') || '[]') as string[];
        const devices: Device[] = [];

        if (providedDevices?.includes('Alarm')) {
            const alarmNativeId = `${this.nativeId}-alarm`;
            const alarmDevice: Device = {
                providerNativeId: this.nativeId,
                name: `${this.name} Alarm`,
                nativeId: alarmNativeId,
                info: {
                    ...this.info,
                },
                interfaces: [
                    ScryptedInterface.OnOff,
                    ScryptedInterface.Readme,
                ],
                type: ScryptedDeviceType.Switch,
            };
            devices.push(alarmDevice);
        }

        if (providedDevices?.includes('SupplementLight')) {
            const supplementLightNativeId = `${this.nativeId}-supplementlight`;
            const supplementLightDevice: Device = {
                providerNativeId: this.nativeId,
                name: `${this.name} Supplemental Light`,
                nativeId: supplementLightNativeId,
                info: {
                    ...this.info,
                },
                interfaces: [
                    ScryptedInterface.OnOff,
                    ScryptedInterface.Brightness,
                    ScryptedInterface.Settings,
                ],
                type: ScryptedDeviceType.Light,
            };
            devices.push(supplementLightDevice);
        }

        sdk.deviceManager.onDevicesChanged({
            providerNativeId: this.nativeId,
            devices,
        });
    }

    async getDevice(nativeId: string): Promise<any> {
        if (nativeId.endsWith('-supplementlight')) {
            this.supplementLight ||= new HikvisionSupplementalLight(this, nativeId);
            return this.supplementLight;
        }
        if (nativeId.endsWith('-alarm')) {
            this.alarm ||= new HikvisionAlarmSwitch(this, nativeId);
            return this.alarm;
        }
    }

    async releaseDevice(id: string, nativeId: string) {
        if (nativeId.endsWith('-supplementlight'))
            delete this.supplementLight;
        else if (nativeId.endsWith('-alarm'))
            delete this.alarm;
    }

    async startIntercom(media: MediaObject): Promise<void> {
        if (this.storage.getItem('twoWayAudio') === 'ONVIF') {
            this.activeIntercom?.kill();
            this.activeIntercom = undefined;
            const options = await this.getConstructedVideoStreamOptions();
            const stream = options[0];
            this.onvifIntercom.url = stream.url;
            return this.onvifIntercom.startIntercom(media);
        }

        const channel = this.getRtspChannel() || '1';
        let codec: string;
        let format: string;

        try {
            const parameters = `http://${this.getHttpAddress()}/ISAPI/System/TwoWayAudio/channels`;
            const { body } = await this.getClient().request({
                url: parameters,
                responseType: 'text',
            });

            const parsedXml = await xml2js.parseStringPromise(body);
            for (const twoWayChannel of parsedXml.TwoWayAudioChannelList.TwoWayAudioChannel) {
                const [id] = twoWayChannel.id;
                if (id !== channel)
                    continue;
                codec = twoWayChannel?.audioCompressionType?.[0];
            }
        }
        catch (e) {
            this.console.error('Failure while determining two way audio codec', e);
        }

        if (codec === 'G.711ulaw') {
            codec = 'pcm_mulaw';
            format = 'mulaw'
        }
        else if (codec === 'G.711alaw') {
            codec = 'pcm_alaw';
            format = 'alaw'
        }
        else {
            if (codec) {
                this.console.warn('Unknown codec', codec);
                this.console.warn('Set your audio codec to G.711ulaw.');
            }
            this.console.warn('Using fallback codec pcm_mulaw. This may not be correct.');
            // seems to ship with this as defaults.
            codec = 'pcm_mulaw';
            format = 'mulaw'
        }

        const buffer = await mediaManager.convertMediaObjectToBuffer(media, ScryptedMimeTypes.FFmpegInput);
        const ffmpegInput = JSON.parse(buffer.toString()) as FFmpegInput;

        const passthrough = new PassThrough();
        const open = `http://${this.getHttpAddress()}/ISAPI/System/TwoWayAudio/channels/${channel}/open`;
        const { body } = await this.getClient().request({
            url: open,
            responseType: 'text',
            method: 'PUT',
        });
        this.console.log('two way audio opened', body);

        const url = `http://${this.getHttpAddress()}/ISAPI/System/TwoWayAudio/channels/${channel}/audioData`;
        this.console.log('posting audio data to', url);

        const put = this.getClient().request({
            url,
            method: 'PUT',
            responseType: 'text',
            headers: {
                'Content-Type': 'application/octet-stream',
                // 'Connection': 'close',
                'Content-Length': '0'
            },
        }, passthrough);

        let available = Buffer.alloc(0);
        this.activeIntercom?.kill();
        const forwarder = this.activeIntercom = await startRtpForwarderProcess(this.console, ffmpegInput, {
            audio: {
                onRtp: rtp => {
                    const parsed = RtpPacket.deSerialize(rtp);
                    available = Buffer.concat([available, parsed.payload]);
                    if (available.length > 1024) {
                        passthrough.push(available.subarray(0, 1024));
                        available = available.subarray(1024);
                    }
                },
                codecCopy: codec,
                encoderArguments: [
                    '-ar', '8000',
                    '-ac', '1',
                    '-acodec', codec,
                ]
            }
        });

        forwarder.killPromise.finally(() => {
            this.console.log('audio finished');
            passthrough.end();
            setTimeout(() => {
                this.stopIntercom();
            }, 1000);
        });

        put.finally(() => {
            this.stopIntercom();
        });

        // the put request will be open until the passthrough is closed.
        put.then(response => {
            if (response.statusCode !== 200)
                forwarder.kill();
        })
            .catch(() => forwarder.kill());
    }

    async stopIntercom(): Promise<void> {
        this.activeIntercom?.kill();
        this.activeIntercom = undefined;

        if (this.storage.getItem('twoWayAudio') === 'ONVIF') {
            return this.onvifIntercom.stopIntercom();
        }

        const client = this.getClient();
        await client.request({
            url: `http://${this.getHttpAddress()}/ISAPI/System/TwoWayAudio/channels/${this.getRtspChannel() || '1'}/close`,
            method: 'PUT',
        });
    }
}

class HikvisionProvider extends RtspProvider {
    clients: Map<string, HikvisionCameraAPI>;

    constructor(nativeId?: ScryptedNativeId) {
        super(nativeId);
        checkPluginNeedsAutoConfigure(this);
    }

    getScryptedDeviceCreator(): string {
        return 'Hikvision Camera';
    }

    getAdditionalInterfaces() {
        return [
            ScryptedInterface.VideoCameraConfiguration,
            ScryptedInterface.Reboot,
            ScryptedInterface.Camera,
            ScryptedInterface.MotionSensor,
            ScryptedInterface.VideoTextOverlays,
        ];
    }

    createSharedClient(address: string, username: string, password: string) {
        if (!this.clients)
            this.clients = new Map();

        const key = `${address}#${username}#${password}`;
        const check = this.clients.get(key);
        if (check)
            return check;
        const client = new HikvisionCameraAPI(address, username, password, this.console);
        this.clients.set(key, client);
        return client;
    }

    createCamera(nativeId: string) {
        return new HikvisionCamera(nativeId, this);
    }

    async createDevice(settings: DeviceCreatorSettings, nativeId?: string): Promise<string> {
        const httpAddress = `${settings.ip}:${settings.httpPort || 80}`;
        let info: DeviceInformation = {};

        const username = settings.username?.toString();
        const password = settings.password?.toString();

        const api = new HikvisionCameraAPI(httpAddress, username, password, this.console);

        if (settings.autoconfigure) {
            const cameraNumber = (settings.rtspChannel as string)?.substring(0, 1) || '1';
            await autoconfigureSettings(api, cameraNumber);
        }

        const skipValidate = settings.skipValidate?.toString() === 'true';
        let twoWayAudio: string;
        if (!skipValidate) {
            try {
                const deviceInfo = await api.getDeviceInfo();

                settings.newCamera = deviceInfo.deviceName;
                info.model = deviceInfo.deviceModel;
                // info.manufacturer = 'Hikvision';
                info.mac = deviceInfo.macAddress;
                info.firmware = deviceInfo.firmwareVersion;
                info.serialNumber = deviceInfo.serialNumber;
            }
            catch (e) {
                this.console.error('Error adding Hikvision camera', e);
                throw e;
            }

            try {
                if (await api.checkTwoWayAudio()) {
                    twoWayAudio = 'Hikvision';
                }
            }
            catch (e) {
                this.console.warn('Error probing two way audio', e);
            }
        }
        settings.newCamera ||= 'Hikvision Camera';

        nativeId = await super.createDevice(settings, nativeId);

        const device = await this.getDevice(nativeId) as HikvisionCamera;
        device.info = info;
        device.putSetting('username', username);
        device.putSetting('password', password);
        if (settings.rtspChannel)
            device.putSetting('rtspChannel', settings.rtspChannel as string);
        device.setHttpPortOverride(settings.httpPort?.toString());
        device.setIPAddress(settings.ip?.toString());
        if (twoWayAudio)
            device.putSetting('twoWayAudio', twoWayAudio);
        device.updateDeviceInfo();
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
            rtspChannelSetting,
            {
                subgroup: 'Advanced',
                key: 'httpPort',
                title: 'HTTP Port',
                description: 'Optional: Override the HTTP Port from the default value of 80.',
                placeholder: '80',
            },
            automaticallyConfigureSettings,
            hikvisionAutoConfigureSettings,
            {
                subgroup: 'Advanced',
                key: 'skipValidate',
                title: 'Skip Validation',
                description: 'Add the device without verifying the credentials and network settings.',
                type: 'boolean',
            }
        ]
    }
}

export default HikvisionProvider;
