import { automaticallyConfigureSettings, checkPluginNeedsAutoConfigure } from "@scrypted/common/src/autoconfigure-codecs";
import sdk, { Camera, DeviceCreatorSettings, DeviceInformation, FFmpegInput, Intercom, MediaObject, MediaStreamOptions, ObjectDetectionResult, ObjectDetectionTypes, ObjectDetector, ObjectsDetected, Reboot, RequestPictureOptions, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, ScryptedNativeId, Setting, VideoCameraConfiguration, VideoTextOverlay, VideoTextOverlays, ScryptedDeviceBase, OnOff, Device, Brightness, Settings, SettingValue } from "@scrypted/sdk";
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
import { StorageSettings } from "@scrypted/sdk/storage-settings";

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

export class HikvisionAlarmSwitch extends ScryptedDeviceBase implements OnOff, Settings {
    storageSettings = new StorageSettings(this, {
        alarmTriggerItems: {
            title: 'Alarm Trigger Items',
            description: 'Select the action types to activate with the alarm.',
            defaultValue: ['audioAlarm', 'whiteLight'],
            multiple: true,
            choices: [
                'audioAlarm',
                'whiteLight'
            ],
        },
        audioAlarmType: {
            title: 'Audio Alarm Type',
            description: 'Select the audio alarm sound clip.',
            type: 'string',
            choices: [],
            defaultValue: '1',
        },
        audioAlarmVolume: {
            title: 'Audio Alarm Volume',
            description: 'Set the audio alarm volume.',
            type: 'number',
            defaultValue: 100,
        },
        alarmTimes: {
            title: 'Alarm Times',
            description: 'Number of repetitions for the audio alarm.',
            type: 'number',
            defaultValue: 5,
        },
        // audioClass: {
        //     title: 'Audio Alarm Class',
        //     description: 'Select the audio alarm class if supported.',
        //     type: 'string',
        //     choices: ['alertAudio', 'promptAudio', 'customAudio'],
        //     defaultValue: 'alertAudio',
        // },
        // customAudioID: {
        //     title: 'Custom Audio ID',
        //     description: 'If custom audio is used, select its ID.',
        //     type: 'number',
        //     // defaultValue: 1,
        // },
        whiteLightDuration: {
            title: 'White Light Duration (s)',
            description: 'Duration (in seconds) for which the white light is enabled (1–60).',
            type: 'number',
            defaultValue: 15,
        },
        whiteLightFrequency: {
            title: 'White Light Frequency',
            description: 'Flashing frequency (e.g., high, medium, low, normallyOn).',
            type: 'string',
            choices: [],
            defaultValue: 'normallyOn',
        },
    });

    on: boolean;

    constructor(public camera: HikvisionCamera, nativeId: string) {
        super(nativeId);
        this.on = false;
    }

    async getSettings(): Promise<Setting[]> {
        let settings = await this.storageSettings.getSettings();

        try {
            const { json } = await this.camera.getClient().getAudioAlarmCapabilities();
            if (json && json.AudioAlarmCap && json.AudioAlarmCap.audioTypeListCap) {
                const choices = json.AudioAlarmCap.audioTypeListCap.map((item: any) => ({
                    title: item.audioDescription,
                    value: item.audioID.toString()
                }));
                const audioAlarmTypeSetting = settings.find(s => s.key === 'audioAlarmType');
                if (audioAlarmTypeSetting) {
                    audioAlarmTypeSetting.choices = choices;
                    if (!audioAlarmTypeSetting.value && choices.length > 0) {
                        audioAlarmTypeSetting.value = choices[0].value;
                    }
                }

                const volCap = json.AudioAlarmCap.audioVolume;
                const timesCap = json.AudioAlarmCap.alarmTimes;
                const audioAlarmVolumeSetting = settings.find(s => s.key === 'audioAlarmVolume');
                if (audioAlarmVolumeSetting && volCap) {
                    audioAlarmVolumeSetting.range = [Number(volCap["@min"]), Number(volCap["@max"])];
                    if (!audioAlarmVolumeSetting.value) {
                        audioAlarmVolumeSetting.value = volCap["@def"];
                    }
                }

                const alarmTimesSetting = settings.find(s => s.key === 'alarmTimes');
                if (alarmTimesSetting && timesCap) {
                    alarmTimesSetting.range = [Number(timesCap["@min"]), Number(timesCap["@max"])];
                    if (!alarmTimesSetting.value) {
                        alarmTimesSetting.value = timesCap["@def"];
                    }
                }
            }
        } catch (e) {
            this.console.error('[AlarmSwitch] Error fetching audio alarm capabilities:', e);
        }

        try {
            const { json: currentConfig } = await this.camera.getClient().getAudioAlarm();
            if (currentConfig && currentConfig.AudioAlarm) {
                const currentAudioID = currentConfig.AudioAlarm.audioID;
                const audioAlarmTypeSetting = settings.find(s => s.key === 'audioAlarmType');
                if (audioAlarmTypeSetting) {
                    audioAlarmTypeSetting.value = currentAudioID.toString();
                }
                const currentAudioVolume = currentConfig.AudioAlarm.audioVolume;
                const audioAlarmVolumeSetting = settings.find(s => s.key === 'audioAlarmVolume');
                if (audioAlarmVolumeSetting && currentAudioVolume !== undefined) {
                    audioAlarmVolumeSetting.value = currentAudioVolume.toString();
                }
                const currentAlarmTimes = currentConfig.AudioAlarm.alarmTimes;
                const alarmTimesSetting = settings.find(s => s.key === 'alarmTimes');
                if (alarmTimesSetting && currentAlarmTimes !== undefined) {
                    alarmTimesSetting.value = currentAlarmTimes.toString();
                }
            }
        } catch (e) {
            this.console.error('[AlarmSwitch] Error fetching current audio alarm configuration:', e);
        }

        try {
            const { json } = await this.camera.getClient().getWhiteLightAlarmCapabilities();
            if (json && json.WhiteLightAlarmCap) {
                const durationCap = json.WhiteLightAlarmCap.durationTime;
                const whiteLightDurationSetting = settings.find(s => s.key === 'whiteLightDuration');
                if (whiteLightDurationSetting && durationCap) {
                    whiteLightDurationSetting.range = [Number(durationCap["@min"]), Number(durationCap["@max"])];
                    if (!whiteLightDurationSetting.value) {
                        whiteLightDurationSetting.value = durationCap["@def"];
                    }
                }
                const frequencyCap = json.WhiteLightAlarmCap.frequency;
                const whiteLightFrequencySetting = settings.find(s => s.key === 'whiteLightFrequency');
                if (whiteLightFrequencySetting && frequencyCap) {
                    whiteLightFrequencySetting.choices = frequencyCap["@opt"].split(',');
                    if (!whiteLightFrequencySetting.value) {
                        whiteLightFrequencySetting.value = frequencyCap["@def"];
                    }
                }
            }
        } catch (e) {
            this.console.error('[AlarmSwitch] Error fetching white light alarm capabilities:', e);
        }

        try {
            const { json: currentWhiteLightConfig } = await this.camera.getClient().getWhiteLightAlarm();
            if (currentWhiteLightConfig && currentWhiteLightConfig.WhiteLightAlarm) {
                const whiteLightAlarm = currentWhiteLightConfig.WhiteLightAlarm;

                const whiteLightDurationSetting = settings.find(s => s.key === 'whiteLightDuration');
                if (whiteLightDurationSetting && whiteLightAlarm.durationTime !== undefined) {
                    whiteLightDurationSetting.value = whiteLightAlarm.durationTime.toString();
                }

                const whiteLightFrequencySetting = settings.find(s => s.key === 'whiteLightFrequency');
                if (whiteLightFrequencySetting && whiteLightAlarm.frequency) {
                    whiteLightFrequencySetting.value = whiteLightAlarm.frequency;
                }
            }
        } catch (e) {
            this.console.error('[AlarmSwitch] Error fetching current white light alarm configuration:', e);
        }
        return settings;
    }
    
    async putSetting(key: string, value: SettingValue): Promise<void> {
        await this.storageSettings.putSetting(key, value);

        const selectedItems: string[] = this.storageSettings.values.alarmTriggerItems || [];
        try {
            const { audioAlarmType, audioAlarmVolume, alarmTimes } = this.storageSettings.values;
            await this.camera.getClient().setAudioAlarm(
                audioAlarmType,
                audioAlarmVolume.toString(),
                alarmTimes.toString()
            );
        
            const { whiteLightDuration, whiteLightFrequency } = this.storageSettings.values;
            await this.camera.getClient().setWhiteLightAlarm({
                durationTime: Number(whiteLightDuration),
                frequency: whiteLightFrequency
            });
        
            await this.camera.getClient().setAlarmTriggerConfig(selectedItems);
        } catch (e) {
            this.console.error('[AlarmSwitch] Error updating alarm configuration:', e);
        }
    }

    async turnOn(): Promise<void> {
        this.on = true;
        try {
            await this.camera.getClient().setAlarm(true);
        } catch (e) {
            this.console.error('[AlarmSwitch] Error triggering alarm input:', e);
            throw e;
        }
    }

    async turnOff(): Promise<void> {
        this.on = false;
        try {
            await this.camera.getClient().setAlarm(false);
        } catch (e) {
            this.console.error('[AlarmSwitch] Error resetting alarm input:', e);
        }
    }
}

export class HikvisionSupplementalLight extends ScryptedDeviceBase implements OnOff, Brightness, Settings {
    storageSettings = new StorageSettings(this, {
        mode: {
            title: 'Mode',
            description: 'Choose "auto" for automatic brightness control or "manual" for custom brightness.',
            defaultValue: 'auto',
            type: 'string',
            choices: ['auto', 'manual'],
            onPut: () => {
                this.setFloodlight(this.on, this.brightness)
                    .catch(err => this.console.error('Error updating mode', err));
            },
        },
        brightness: {
            title: 'Manual Brightness',
            description: 'Set brightness when in manual mode (0 to 100)',
            defaultValue: 0,
            type: 'number',
            placeholder: '0-100',
            onPut: () => {
                const brightness = parseInt(this.storage.getItem('brightness') || '0');
                this.brightness = brightness;
                if (this.on) {
                    this.setFloodlight(this.on, brightness)
                        .catch(err => this.console.error('Error updating brightness', err));
                }
            },
            onGet: async () => {
                const mode = this.storageSettings.values.mode;
                if (mode === 'manual') {
                    const stored = this.storage.getItem('manualBrightness');
                    return { value: stored && stored !== '' ? stored : '100', range: [0, 100] };
                }
                return { value: '', hide: true };
            }
        },
    });

    brightness: number;
    on: boolean;

    constructor(public camera: HikvisionCamera, nativeId: string) {
        super(nativeId);
        this.on = false;
        this.brightness = 0;
    }

    async setBrightness(brightness: number): Promise<void> {
        this.brightness = brightness;
        const on = brightness > 0;
        await this.setFloodlight(on, brightness);
    }

    async turnOff(): Promise<void> {
        this.on = false;
        this.brightness = 0;
        await this.setFloodlight(false, 0);
    }

    async turnOn(): Promise<void> {
        this.on = true;
        if (this.brightness === 0) {
            this.brightness = 100;
        }
        await this.setFloodlight(true, this.brightness);
    }

    private async setFloodlight(on: boolean, brightness: number): Promise<void> {
        const api = this.camera.getClient();
        let mode: 'auto' | 'manual';
        const storedMode = this.storage.getItem('mode');
        if (storedMode === 'auto' || storedMode === 'manual') {
            mode = storedMode;
        } else {
            mode = on ? 'manual' : 'auto';
        }
        await api.setSupplementLight({ on, brightness, mode });
    }

    async getSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }

    async putSetting(key: string, value: SettingValue): Promise<void> {
        await this.storageSettings.putSetting(key, value);
    }
}

export class HikvisionCamera extends RtspSmartCamera implements Camera, Intercom, Reboot, ObjectDetector, VideoCameraConfiguration, VideoTextOverlays {
    detectedChannels: Promise<Map<string, MediaStreamOptions>>;
    onvifIntercom = new OnvifIntercom(this);
    activeIntercom: Awaited<ReturnType<typeof startRtpForwarderProcess>>;
    hasSmartDetection: boolean;
    floodlight: HikvisionSupplementalLight;
    alarm: HikvisionAlarmSwitch;

    client: HikvisionAPI;

    constructor(nativeId: string, provider: RtspProvider) {
        super(nativeId, provider);

        this.hasSmartDetection = this.storage.getItem('hasSmartDetection') === 'true';
        this.updateDevice();
        this.updateDeviceInfo();
        (async () => {
            await this.reportDevices();
        })();
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

    async hasFloodlight(): Promise<boolean> {
        try {
            const client = this.getClient();
            const { json } = await client.getSupplementLight();
            return !!(json && json.SupplementLight);
        }
        catch (e) {
            if ((e.statusCode && e.statusCode === 403) ||
                (typeof e.message === 'string' && e.message.includes('403'))) {
                return false;
            }
            this.console.error('Error checking supplemental light', e);
            return false;
        }
    }

    async hasAlarm(): Promise<boolean> {
        try {
            const client = this.getClient();
            const config = await client.getAlarmTriggerConfig();
            return config.audioAlarmSupported || config.whiteLightAlarmSupported || config.ioSupported;
        }
        catch (e) {
            if ((e.statusCode && e.statusCode === 403) ||
                (typeof e.message === 'string' && e.message.includes('403'))) {
                return false;
            }
            this.console.error('Error checking alarm', e);
            return false;
        }
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

        if (this.hasFloodlight || this.hasAlarm) {
            interfaces.push(ScryptedInterface.DeviceProvider);
        }

        this.provider.updateDevice(this.nativeId, this.name, interfaces, type);
    }

    async putSetting(key: string, value: string) {
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
        }

        this.client = undefined;
        this.detectedChannels = undefined;
        super.putSetting(key, value);

        this.updateDevice();
        this.updateDeviceInfo();
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
        );

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

    async reportDevices() {
        const devices: Device[] = [];

        if (await this.hasAlarm()) {
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
                    ScryptedInterface.Settings,
                ],
                type: ScryptedDeviceType.Switch,
            };
            devices.push(alarmDevice);
        }

        if (await this.hasFloodlight()) {
            const floodlightNativeId = `${this.nativeId}-floodlight`;
            const floodlightDevice: Device = {
                providerNativeId: this.nativeId,
                name: `${this.name} Floodlight`,
                nativeId: floodlightNativeId,
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
            devices.push(floodlightDevice);
        }
        sdk.deviceManager.onDevicesChanged({
            providerNativeId: this.nativeId,
            devices
        });
    }

    async getDevice(nativeId: string): Promise<any> {
        if (nativeId.endsWith('-floodlight')) {
            this.floodlight ||= new HikvisionSupplementalLight(this, nativeId);
            return this.floodlight;
        }
        if (nativeId.endsWith('-alarm')) {
            this.alarm ||= new HikvisionAlarmSwitch(this, nativeId);
            return this.alarm;
        }
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
