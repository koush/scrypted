import { sleep } from '@scrypted/common/src/sleep';
import sdk, { Brightness, Camera, Device, DeviceProvider, Intercom, MediaObject, ObjectDetectionTypes, ObjectDetector, ObjectsDetected, OnOff, PanTiltZoom, PanTiltZoomCommand, RequestPictureOptions, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting, Settings, Sleep, VideoTextOverlay, VideoTextOverlays } from "@scrypted/sdk";
import { StorageSettings } from '@scrypted/sdk/storage-settings';
import { createRtspMediaStreamOptions, RtspSmartCamera, UrlMediaStreamOptions } from "../../../rtsp/src/rtsp";
import { connectCameraAPI, OnvifCameraAPI } from '../onvif-api';
import { OnvifIntercom } from '../onvif-intercom';
import { AIState, BatteryInfoResponse, DeviceStatusResponse, Enc, EventsResponse } from './api';
import { ReolinkNvrDevice } from './nvr';

export const moToB64 = async (mo: MediaObject) => {
    const bufferImage = await sdk.mediaManager.convertMediaObjectToBuffer(mo, 'image/jpeg');
    return bufferImage?.toString('base64');
}

export const b64ToMo = async (b64: string) => {
    const buffer = Buffer.from(b64, 'base64');
    return await sdk.mediaManager.createMediaObject(buffer, 'image/jpeg');
}

class ReolinkCameraSiren extends ScryptedDeviceBase implements OnOff {
    sirenTimeout: NodeJS.Timeout;

    constructor(public camera: ReolinkNvrCamera, nativeId: string) {
        super(nativeId);
    }

    async turnOff() {
        this.on = false;
        await this.setSiren(false);
    }

    async turnOn() {
        this.on = true;
        await this.setSiren(true);
    }

    private async setSiren(on: boolean) {
        const api = this.camera.getClient();

        // doorbell doesn't seem to support alarm_mode = 'manul'
        if (this.camera.storageSettings.values.doorbell) {
            if (!on) {
                clearInterval(this.sirenTimeout);
                await api.setSiren(this.camera.getRtspChannel(), false);
                return;
            }

            // siren lasts around 4 seconds.
            this.sirenTimeout = setTimeout(async () => {
                await this.turnOff();
            }, 4000);

            await api.setSiren(this.camera.getRtspChannel(), true, 1);
            return;
        }
        await api.setSiren(this.camera.getRtspChannel(), on);
    }
}

class ReolinkCameraFloodlight extends ScryptedDeviceBase implements OnOff, Brightness {
    constructor(public camera: ReolinkNvrCamera, nativeId: string) {
        super(nativeId);
    }

    async setBrightness(brightness: number): Promise<void> {
        this.brightness = brightness;
        await this.setFloodlight(undefined, brightness);
    }

    async turnOff() {
        this.on = false;
        await this.setFloodlight(false);
    }

    async turnOn() {
        this.on = true;
        await this.setFloodlight(true);
    }

    private async setFloodlight(on?: boolean, brightness?: number) {
        const api = this.camera.getClient();

        await api.setWhiteLedState(this.camera.getRtspChannel(), on, brightness);
    }
}

class ReolinkCameraPirSensor extends ScryptedDeviceBase implements OnOff {
    constructor(public camera: ReolinkNvrCamera, nativeId: string) {
        super(nativeId);
    }

    async turnOff() {
        this.on = false;
        await this.setPir(false);
    }

    async turnOn() {
        this.on = true;
        await this.setPir(true);
    }

    private async setPir(on: boolean) {
        const api = this.camera.getClient();

        await api.setPirState(this.camera.getRtspChannel(), on);
    }
}

export class ReolinkNvrCamera extends RtspSmartCamera implements Camera, DeviceProvider, Intercom, ObjectDetector, PanTiltZoom, Sleep, VideoTextOverlays {
    onvifClient: OnvifCameraAPI;
    onvifIntercom = new OnvifIntercom(this);
    videoStreamOptions: Promise<UrlMediaStreamOptions[]>;
    motionTimeout: NodeJS.Timeout;
    siren: ReolinkCameraSiren;
    floodlight: ReolinkCameraFloodlight;
    pirSensor: ReolinkCameraPirSensor;
    lastB64Snapshot: string;
    lastSnapshotTaken: number;
    nvrDevice: ReolinkNvrDevice;
    abilities: any;

    storageSettings = new StorageSettings(this, {
        debugEvents: {
            title: 'Debug Events',
            type: 'boolean',
            immediate: true,
        },
        doorbell: {
            title: 'Doorbell',
            description: 'This camera is a Reolink Doorbell.',
            type: 'boolean',
        },
        rtspChannel: {
            subgroup: 'Advanced',
            title: 'Channel',
            type: 'number',
            hide: true,
        },
        motionTimeout: {
            subgroup: 'Advanced',
            title: 'Motion Timeout',
            defaultValue: 20,
            type: 'number',
        },
        presets: {
            subgroup: 'Advanced',
            title: 'Presets',
            description: 'PTZ Presets in the format "id=name". Where id is the PTZ Preset identifier and name is a friendly name.',
            multiple: true,
            defaultValue: [],
            combobox: true,
            onPut: async (ov, presets: string[]) => {
                const caps = {
                    ...this.ptzCapabilities,
                    presets: {},
                };
                for (const preset of presets) {
                    const [key, name] = preset.split('=');
                    caps.presets[key] = name;
                }
                this.ptzCapabilities = caps;
            },
            mapGet: () => {
                const presets = this.ptzCapabilities?.presets || {};
                return Object.entries(presets).map(([key, name]) => key + '=' + name);
            },
        },
        cachedPresets: {
            multiple: true,
            hide: true,
            json: true,
            defaultValue: [],
        },
        cachedOsd: {
            multiple: true,
            hide: true,
            json: true,
            defaultValue: [],
        },
        // useOnvifDetections: {
        //     subgroup: 'Advanced',
        //     title: 'Use ONVIF for Object Detection',
        //     choices: [
        //         'Default',
        //         'Enabled',
        //         'Disabled',
        //     ],
        //     defaultValue: 'Default',
        // },
        useOnvifTwoWayAudio: {
            subgroup: 'Advanced',
            title: 'Use ONVIF for Two-Way Audio',
            type: 'boolean',
        },
        prebufferSet: {
            type: 'boolean',
            hide: true
        }
    });

    constructor(nativeId: string, nvrDevice: ReolinkNvrDevice) {
        super(nativeId, nvrDevice.plugin);
        this.nvrDevice = nvrDevice;

        this.storageSettings.settings.useOnvifTwoWayAudio.onGet = async () => {
            return {
                hide: !!this.storageSettings.values.doorbell,
            }
        };

        // this.storageSettings.settings.ptz.onGet = async () => {
        //     return {
        //         hide: !!this.storageSettings.values.doorbell,
        //     }
        // };

        this.storageSettings.settings.presets.onGet = async () => {
            const choices = this.storageSettings.values.cachedPresets.map((preset) => preset.id + '=' + preset.name);
            return {
                choices,
            };
        };

        const channel = Number(this.storageSettings.values.rtspChannel);
        if (!Number.isNaN(channel)) {
            this.nvrDevice.cameraNativeMap.set(this.nativeId, this);
        }

        this.init().catch(this.getLogger().error);
    }

    public getLogger() {
        return this.console;
    }

    async init() {
        const logger = this.getLogger();

        while (!this.nvrDevice.client || !this.nvrDevice.client.loggedIn) {
            logger.log('Waiting for plugin connection');
            await sleep(3000);
        }

        await this.reportDevices();
        await this.updateDevice();
        this.updateDeviceInfo();
        this.updatePtzCaps();
    }

    getClient() {
        return this.nvrDevice.getClient();
    }

    async getVideoTextOverlays(): Promise<Record<string, VideoTextOverlay>> {
        const client = this.getClient();
        if (!client) {
            return;
        }
        const { cachedOsd } = this.storageSettings.values;

        return {
            osdChannel: {
                text: cachedOsd.value.Osd.osdChannel.enable ? cachedOsd.value.Osd.osdChannel.name : undefined,
            },
            osdTime: {
                text: !!cachedOsd.value.Osd.osdTime.enable,
                readonly: true,
            }
        }
    }

    async setVideoTextOverlay(id: 'osdChannel' | 'osdTime', value: VideoTextOverlay): Promise<void> {
        const client = this.getClient();
        if (!client) {
            return;
        }

        const osd = await client.getOsd(this.getRtspChannel());
        if (id === 'osdChannel') {
            const osdValue = osd.value.Osd.osdChannel;
            osdValue.enable = value.text ? 1 : 0;
            // name must always be valid.
            osdValue.name = typeof value.text === 'string' && value.text
                ? value.text
                : osdValue.name || 'Camera';
        }
        else if (id === 'osdTime') {
            const osdValue = osd.value.Osd.osdTime;
            osdValue.enable = value.text ? 1 : 0;
        }
        else {
            throw new Error('unknown overlay: ' + id);
        }

        await client.setOsd(this.getRtspChannel(), osd);
    }

    updatePtzCaps() {
        const { hasPanTilt, hasZoom } = this.getPtzCapabilities();
        this.ptzCapabilities = {
            ...this.ptzCapabilities,
            pan: hasPanTilt,
            tilt: hasPanTilt,
            zoom: hasZoom,
        }
    }

    getAbilities() {
        if (!this.abilities) {
            const channel = Number(this.getRtspChannel());
            this.abilities = this.nvrDevice.storageSettings.values.abilities?.Ability?.abilityChn?.[channel];
        }

        return this.abilities;
    }

    getEncoderSettings() {
        return this.getDeviceData()?.enc?.Enc;
    }

    async getDetectionInput(detectionId: string, eventId?: any): Promise<MediaObject> {
        return;
    }

    async ptzCommand(command: PanTiltZoomCommand): Promise<void> {
        const client = this.getClient();
        if (!client) {
            return;
        }
        client.ptz(this.getRtspChannel(), command);
    }

    getDeviceData() {
        const channel = this.getRtspChannel();
        return this.nvrDevice.storageSettings.values.devicesData?.[channel];
    }

    async getObjectTypes(): Promise<ObjectDetectionTypes> {
        try {
            const deviceData = this.getDeviceData();
            const ai: AIState = deviceData?.ai;
            const classes: string[] = [];

            for (const key of Object.keys(ai ?? {})) {
                if (key === 'channel')
                    continue;
                const { alarm_state, support } = ai[key];
                if (support)
                    classes.push(key);
            }
            return {
                classes,
            };
        }
        catch (e) {
            return {
                classes: [],
            };
        }
    }

    async startIntercom(media: MediaObject): Promise<void> {
        if (!this.onvifIntercom.url) {
            const client = await this.getOnvifClient();
            const streamUrl = await client.getStreamUrl();
            this.onvifIntercom.url = streamUrl;
        }
        return this.onvifIntercom.startIntercom(media);
    }

    stopIntercom(): Promise<void> {
        return this.onvifIntercom.stopIntercom();
    }

    hasSiren() {
        const abilities = this.getAbilities();
        const hasAbility = abilities?.supportAudioAlarm;

        return (hasAbility && hasAbility?.ver !== 0);
    }

    hasFloodlight() {
        const channelData = this.getAbilities();

        const floodLightConfigVer = channelData?.floodLight?.ver ?? 0;
        const supportFLswitchConfigVer = channelData?.supportFLswitch?.ver ?? 0;
        const supportFLBrightnessConfigVer = channelData?.supportFLBrightness?.ver ?? 0;

        return floodLightConfigVer > 0 || supportFLswitchConfigVer > 0 || supportFLBrightnessConfigVer > 0;
    }

    hasBattery() {
        const abilities = this.getAbilities();
        const batteryConfigVer = abilities?.battery?.ver ?? 0;
        return batteryConfigVer > 0;
    }

    getPtzCapabilities() {
        const abilities = this.getAbilities();
        const hasZoom = (abilities?.supportDigitalZoom?.ver ?? 0) > 0;
        const hasPanTilt = (abilities?.ptzCtrl?.ver ?? 0) > 0;
        const hasPresets = (abilities?.ptzPreset?.ver ?? 0) > 0;

        return {
            hasZoom,
            hasPanTilt,
            hasPresets,
            hasPtz: hasZoom || hasPanTilt || hasPresets
        };
    }

    hasPtzCtrl() {
        const abilities = this.getAbilities();
        const zoomVer = abilities?.supportDigitalZoom?.ver ?? 0;
        return zoomVer > 0;
    }

    hasPirEvents() {
        const abilities = this.getAbilities();
        const pirEvents = abilities?.mdWithPir?.ver ?? 0;
        return pirEvents > 0;
    }

    async updateDevice() {
        const logger = this.getLogger();
        const interfaces = [
            ScryptedInterface.VideoCamera,
            ScryptedInterface.Settings,
            ...this.nvrDevice.plugin.getAdditionalInterfaces(),
        ];
        let type = ScryptedDeviceType.Camera;
        if (this.storageSettings.values.doorbell) {
            interfaces.push(
                ScryptedInterface.BinarySensor,
            );
            type = ScryptedDeviceType.Doorbell;
        }
        if (this.storageSettings.values.doorbell || this.storageSettings.values.useOnvifTwoWayAudio) {
            interfaces.push(
                ScryptedInterface.Intercom
            );
        }
        const rtspChannel = this.getRtspChannel()
        const name = this.nvrDevice.storageSettings.values.devicesData[rtspChannel]?.channelStatus?.name;

        if (this.getPtzCapabilities().hasPtz) {
            interfaces.push(ScryptedInterface.PanTiltZoom);
        }
        if ((await this.getObjectTypes()).classes.length > 0) {
            interfaces.push(ScryptedInterface.ObjectDetector);
        }
        if (this.hasSiren() || this.hasFloodlight() || this.hasPirEvents())
            interfaces.push(ScryptedInterface.DeviceProvider);
        if (this.hasBattery()) {
            interfaces.push(ScryptedInterface.Battery, ScryptedInterface.Sleep);
        }

        await sdk.deviceManager.onDeviceDiscovered({
            nativeId: this.nativeId,
            providerNativeId: this.nvrDevice.nativeId,
            name,
            interfaces,
            type,
            info: sdk.deviceManager.getNativeIds().includes(this.nativeId) ?
                sdk.deviceManager.getDeviceState(this.nativeId)?.info :
                undefined,
        });

        if (this.hasBattery() && !this.storageSettings.getItem('prebufferSet')) {
            const device = sdk.systemManager.getDeviceById<Settings>(this.id);
            logger.log('Disabling prebbufer for battery cam');
            await device.putSetting('prebuffer:enabledStreams', '[]');
            this.storageSettings.values.prebufferSet = true;
        }
    }

    async processBatteryData(data: BatteryInfoResponse) {
        const logger = this.getLogger();
        const { batteryLevel, sleeping } = data;
        const { debugEvents } = this.storageSettings.values;

        if (debugEvents) {
            logger.debug(`Battery info received: ${JSON.stringify(data)}`);
        }

        if (sleeping !== this.sleeping) {
            this.sleeping = sleeping;
        }

        if (batteryLevel !== this.batteryLevel) {
            this.batteryLevel = batteryLevel;
        }
    }

    async processDeviceStatusData(data: DeviceStatusResponse) {
        const { floodlightEnabled, pirEnabled, ptzPresets, osd } = data;
        const logger = this.getLogger();

        const { debugEvents } = this.storageSettings.values;
        if (debugEvents) {
            logger.info(`Device status received: ${JSON.stringify(data)}`);
        }

        if (this.floodlight && floodlightEnabled !== this.floodlight.on) {
            this.floodlight.on = floodlightEnabled;
        }

        if (this.pirSensor && pirEnabled !== this.pirSensor.on) {
            this.pirSensor.on = pirEnabled;
        }

        if (ptzPresets) {
            this.storageSettings.values.cachedPresets = ptzPresets
        }

        if (osd) {
            this.storageSettings.values.cachedOsd = osd
        }
    }

    updateDeviceInfo() {
        const ip = this.nvrDevice.storageSettings.values.ipAddress
        if (!ip)
            return;
        const info = this.info || {};
        info.ip = ip;

        const deviceData = this.getDeviceData();

        info.serialNumber = deviceData?.serial;
        info.firmware = deviceData?.firmVer;
        info.version = deviceData?.boardInfo;
        info.model = deviceData?.typeInfo;
        info.manufacturer = 'Reolink';
        info.managementUrl = `http://${ip}`;
        this.info = info;
    }

    async getOnvifClient() {
        if (!this.onvifClient)
            this.onvifClient = await this.createOnvifClient();
        return this.onvifClient;
    }

    createOnvifClient() {
        const { username, password, httpPort, ipAddress } = this.nvrDevice.storageSettings.values;
        const address = `${ipAddress}:${httpPort}`;
        return connectCameraAPI(address, username, password, this.getLogger(), this.storageSettings.values.doorbell ? this.storage.getItem('onvifDoorbellEvent') : undefined);
    }

    async processEvents(events: EventsResponse) {
        const logger = this.getLogger();

        const { debugEvents } = this.storageSettings.values;
        if (debugEvents) {
            logger.debug(`Events received: ${JSON.stringify(events)}`);
        }

        if (events.motion !== this.motionDetected) {
            if (events.motion) {

                this.motionDetected = true;
                this.motionTimeout && clearTimeout(this.motionTimeout);
                this.motionTimeout = setTimeout(() => this.motionDetected = false, this.storageSettings.values.motionTimeout * 1000);
            } else {
                this.motionDetected = false;
                this.motionTimeout && clearTimeout(this.motionTimeout);
            }
        }

        if (events.objects.length) {
            const od: ObjectsDetected = {
                timestamp: Date.now(),
                detections: [],
            };
            for (const c of events.objects) {
                od.detections.push({
                    className: c,
                    score: 1,
                });
            }
            sdk.deviceManager.onDeviceEvent(this.nativeId, ScryptedInterface.ObjectDetector, od);
        }
    }

    async listenLoop() {
        return null;
    }

    async listenEvents() {
        return null;
    }

    async takeSnapshotInternal(timeout?: number) {
        const now = Date.now();
        const client = this.getClient();
        const mo = await this.createMediaObject(await client.jpegSnapshot(this.getRtspChannel(), timeout), 'image/jpeg');
        this.lastB64Snapshot = await moToB64(mo);
        this.lastSnapshotTaken = now;

        return mo;
    }

    async takeSmartCameraPicture(options?: RequestPictureOptions): Promise<MediaObject> {
        const isBattery = this.hasBattery();
        const now = Date.now();
        const logger = this.getLogger();

        const isMaxTimePassed = !this.lastSnapshotTaken || ((now - this.lastSnapshotTaken) > 1000 * 60 * 60);
        const isBatteryTimePassed = !this.lastSnapshotTaken || ((now - this.lastSnapshotTaken) > 1000 * 15);
        let canTake = false;

        if (!this.lastB64Snapshot || !this.lastSnapshotTaken) {
            logger.log('Allowing new snapshot because not taken yet');
            canTake = true;
        } else if (this.sleeping && isMaxTimePassed) {
            logger.log('Allowing new snapshot while sleeping because older than 1 hour');
            canTake = true;
        } else if (!this.sleeping && isBattery && isBatteryTimePassed) {
            logger.log('Allowing new snapshot because older than 15 seconds');
            canTake = true;
        } else {
            canTake = true;
        }

        if (canTake) {
            return this.takeSnapshotInternal(options?.timeout);
        } else if (this.lastB64Snapshot) {
            const mo = await b64ToMo(this.lastB64Snapshot);

            return mo;
        } else {
            return null;
        }
    }

    getRtspChannel() {
        return this.storageSettings.values.rtspChannel;
    }

    createRtspMediaStreamOptions(url: string, index: number) {
        const ret = createRtspMediaStreamOptions(url, index);
        ret.tool = 'scrypted';
        return ret;
    }

    addRtspCredentials(rtspUrl: string) {
        const { username, password } = this.nvrDevice.storageSettings.values;
        const url = new URL(rtspUrl);
        // if (url.protocol !== 'rtmp:') {
        url.username = username;
        url.password = password;
        // } else {
        // const params = url.searchParams;
        // for (const [k, v] of Object.entries(this.plugin.client.parameters)) {
        //     params.set(k, v);
        // }
        // }
        return url.toString();
    }

    async createVideoStream(vso: UrlMediaStreamOptions): Promise<MediaObject> {
        await this.nvrDevice.client.login();
        return super.createVideoStream(vso);
    }

    async getConstructedVideoStreamOptions(): Promise<UrlMediaStreamOptions[]> {
        const encoderConfig: Enc = this.getEncoderSettings();

        const rtspChannel = this.getRtspChannel();
        const channel = (rtspChannel + 1).toString().padStart(2, '0');

        const streams: UrlMediaStreamOptions[] = [
            {
                name: '',
                id: 'main.bcs',
                container: 'rtmp',
                video: { width: 2560, height: 1920 },
                url: ''
            },
            {
                name: '',
                id: 'ext.bcs',
                container: 'rtmp',
                video: { width: 896, height: 672 },
                url: ''
            },
            {
                name: '',
                id: 'sub.bcs',
                container: 'rtmp',
                video: { width: 640, height: 480 },
                url: ''
            },
            {
                name: '',
                id: `h264Preview_${channel}_main`,
                container: 'rtsp',
                video: { codec: 'h264', width: 2560, height: 1920 },
                url: ''
            },
            {
                name: '',
                id: `h264Preview_${channel}_sub`,
                container: 'rtsp',
                video: { codec: 'h264', width: 640, height: 480 },
                url: ''
            }
        ];

        // abilityChn->live
        // 0: not support
        // 1: support main/extern/sub stream
        // 2: support main/sub stream

        const abilities = this.getAbilities();
        const { channelInfo } = this.getDeviceData();

        const live = abilities?.live?.ver;
        const [rtmpMain, rtmpExt, rtmpSub, rtspMain, rtspSub] = streams;
        streams.splice(0, streams.length);

        const mainEncType = abilities?.mainEncType?.ver;

        const isHomeHub = this.nvrDevice.info.model === 'Reolink Home Hub';
        if (isHomeHub) {
            streams.push(...[rtspMain, rtspSub]);
        } else if (live === 2) {
            if (mainEncType === 1) {
                streams.push(rtmpSub, rtspMain, rtspSub);
            }
            else {
                streams.push(rtmpMain, rtmpSub, rtspMain, rtspSub);
            }
        }
        else if (mainEncType === 1) {
            streams.push(rtmpExt, rtmpSub, rtspMain, rtspSub);
        }
        else {
            streams.push(rtmpMain, rtmpExt, rtmpSub, rtspMain, rtspSub);
        }

        if (channelInfo.typeInfo &&
            [
                "Reolink TrackMix PoE",
                "Reolink TrackMix WiFi",
                "RLC-81MA",
                "Trackmix Series W760"
            ].includes(channelInfo.typeInfo)) {
            streams.push({
                name: '',
                id: 'autotrack.bcs',
                container: 'rtmp',
                video: { width: 896, height: 512 },
                url: '',
            });

            if (rtspChannel === 0) {
                streams.push({
                    name: '',
                    id: `h264Preview_02_main`,
                    container: 'rtsp',
                    video: { codec: 'h264', width: 3840, height: 2160 },
                    url: ''
                }, {
                    name: '',
                    id: `h264Preview_02_sub`,
                    container: 'rtsp',
                    video: { codec: 'h264', width: 640, height: 480 },
                    url: ''
                })
            }
        }

        for (const stream of streams) {
            var streamUrl;
            if (stream.container === 'rtmp') {
                streamUrl = new URL(`rtmp://${this.getRtmpAddress()}/bcs/channel${rtspChannel}_${stream.id}`)
                const params = streamUrl.searchParams;
                params.set("channel", rtspChannel.toString())
                params.set("stream", '0')
                stream.url = streamUrl.toString();
                stream.name = `RTMP ${stream.id}`;
            } else if (stream.container === 'rtsp') {
                streamUrl = new URL(`rtsp://${this.getRtspAddress()}/${stream.id}`)
                stream.url = streamUrl.toString();
                stream.name = `RTSP ${stream.id}`;
            }
        }

        if (encoderConfig) {
            const { mainStream } = encoderConfig;
            if (mainStream?.width && mainStream?.height) {
                for (const stream of streams) {
                    if (stream.id === 'main.bcs' || stream.id === `h264Preview_${channel}_main`) {
                        stream.video.width = mainStream.width;
                        stream.video.height = mainStream.height;
                    }
                }
            }
        }

        return streams;
    }

    async getSettings(): Promise<Setting[]> {
        const settings = await this.storageSettings.getSettings();
        return settings;
    }

    async putSetting(key: string, value: string) {
        if (this.storageSettings.keys[key]) {
            await this.storageSettings.putSetting(key, value);
        }
        else {
            await super.putSetting(key, value);
        }
    }

    showRtspUrlOverride() {
        return false;
    }

    getRtspAddress() {
        const { ipAddress, rtspPort } = this.nvrDevice.storageSettings.values;
        return `${ipAddress}:${rtspPort}`;
    }

    getRtmpAddress() {
        const { ipAddress, rtmpPort } = this.nvrDevice.storageSettings.values;
        return `${ipAddress}:${rtmpPort}`;
    }

    async reportDevices() {
        const hasSiren = this.hasSiren();
        const hasFloodlight = this.hasFloodlight();
        const hasPirEvents = this.hasPirEvents();

        const devices: Device[] = [];

        if (hasSiren) {
            const sirenNativeId = `${this.nativeId}-siren`;
            const sirenDevice: Device = {
                providerNativeId: this.nativeId,
                name: `${this.name} Siren`,
                nativeId: sirenNativeId,
                info: {
                    ...this.info,
                },
                interfaces: [
                    ScryptedInterface.OnOff
                ],
                type: ScryptedDeviceType.Siren,
            };

            devices.push(sirenDevice);
        }

        if (hasFloodlight) {
            const floodlightNativeId = `${this.nativeId}-floodlight`;
            const floodlightDevice: Device = {
                providerNativeId: this.nativeId,
                name: `${this.name} Floodlight`,
                nativeId: floodlightNativeId,
                info: {
                    ...this.info,
                },
                interfaces: [
                    ScryptedInterface.OnOff
                ],
                type: ScryptedDeviceType.Light,
            };

            devices.push(floodlightDevice);
        }

        if (hasPirEvents) {
            const pirNativeId = `${this.nativeId}-pir`;
            const pirDevice: Device = {
                providerNativeId: this.nativeId,
                name: `${this.name} PIR sensor`,
                nativeId: pirNativeId,
                info: {
                    ...this.info,
                },
                interfaces: [
                    ScryptedInterface.OnOff
                ],
                type: ScryptedDeviceType.Switch,
            };

            devices.push(pirDevice);
        }

        sdk.deviceManager.onDevicesChanged({
            providerNativeId: this.nativeId,
            devices
        });
    }

    async getDevice(nativeId: string): Promise<any> {
        if (nativeId.endsWith('-siren')) {
            this.siren ||= new ReolinkCameraSiren(this, nativeId);
            return this.siren;
        } else if (nativeId.endsWith('-floodlight')) {
            this.floodlight ||= new ReolinkCameraFloodlight(this, nativeId);
            return this.floodlight;
        } else if (nativeId.endsWith('-pir')) {
            this.pirSensor ||= new ReolinkCameraPirSensor(this, nativeId);
            return this.pirSensor;
        }
    }

    async releaseDevice(id: string, nativeId: string) {
        if (nativeId.endsWith('-siren')) {
            delete this.siren;
        } else if (nativeId.endsWith('-floodlight')) {
            delete this.floodlight;
        } else if (nativeId.endsWith('-pir')) {
            delete this.pirSensor;
        }
    }
}