import { sleep } from '@scrypted/common/src/sleep';
import { Camera, DeviceCreatorSettings, DeviceInformation, Intercom, MediaObject, PictureOptions, Reboot, ScryptedDeviceType, ScryptedInterface, Setting } from "@scrypted/sdk";
import { StorageSettings } from '@scrypted/sdk/storage-settings';
import { EventEmitter } from "stream";
import { Destroyable, RtspProvider, RtspSmartCamera, UrlMediaStreamOptions } from "../../rtsp/src/rtsp";
import { OnvifCameraAPI, connectCameraAPI } from './onvif-api';
import { listenEvents } from './onvif-events';
import { OnvifIntercom } from './onvif-intercom';
import { ReolinkCameraClient } from './reolink-api';

class ReolinkCamera extends RtspSmartCamera implements Camera, Reboot, Intercom {
    client: ReolinkCameraClient;
    onvifClient: OnvifCameraAPI;
    onvifIntercom = new OnvifIntercom(this);

    storageSettings = new StorageSettings(this, {
        doorbell: {
            title: 'Doorbell',
            description: 'This camera is a Reolink Doorbell.',
            type: 'boolean',
        },
        rtmpPort: {
            subgroup: 'Advanced',
            title: 'RTMP Port Override',
            placeholder: '1935',
            type: 'number',
        }
    });

    constructor(nativeId: string, provider: RtspProvider) {
        super(nativeId, provider);

        this.updateManagementUrl();
        this.updateDevice();
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

    updateDevice() {
        const interfaces = this.provider.getInterfaces();
        let type = ScryptedDeviceType.Camera;
        let name = 'Reolink Camera';
        if (this.storageSettings.values.doorbell) {
            interfaces.push(
                ScryptedInterface.BinarySensor,
                ScryptedInterface.Intercom
            );
            type = ScryptedDeviceType.Doorbell;
            name = 'Reolink Doorbell';
        }
        this.provider.updateDevice(this.nativeId, name, interfaces, type);
    }

    async reboot() {
        const client = this.getClient();
        await client.reboot();
    }

    updateManagementUrl() {
        const ip = this.storage.getItem('ip');
        if (!ip)
            return;
        const info = this.info || {};
        info.ip = ip;
        info.manufacturer = 'Reolink';
        info.managementUrl = `http://${ip}`;
        this.info = info;
    }

    getClient() {
        if (!this.client)
            this.client = new ReolinkCameraClient(this.getHttpAddress(), this.getUsername(), this.getPassword(), this.getRtspChannel(), this.console);
        return this.client;
    }


    async getOnvifClient() {
        if (!this.onvifClient)
            this.onvifClient = await this.createOnvifClient();
        return this.onvifClient;
    }

    createOnvifClient() {
        return connectCameraAPI(this.getHttpAddress(), this.getUsername(), this.getPassword(), this.console, this.storage.getItem('onvifDoorbellEvent'));
    }

    async listenEvents() {
        if (this.storageSettings.values.doorbell)
            return listenEvents(this, await this.createOnvifClient());

        const client = this.getClient();
        let killed = false;
        const events = new EventEmitter();
        const ret: Destroyable = {
            on: function (eventName: string | symbol, listener: (...args: any[]) => void): void {
                events.on(eventName, listener);
            },
            destroy: function (): void {
                killed = true;
            },
            emit: function (eventName: string | symbol, ...args: any[]): boolean {
                return events.emit(eventName, ...args);
            }
        };

        (async () => {
            while (!killed) {
                try {
                    // const ai = await client.getAiState();
                    // ret.emit('data', JSON.stringify(ai));
                    const { value, data } = await client.getMotionState();
                    this.motionDetected = value;
                    ret.emit('data', JSON.stringify(data));
                }
                catch (e) {
                    ret.emit('error', e);
                }
                await sleep(1000);
            }
        })();
        return ret;
    }

    async takeSmartCameraPicture(option?: PictureOptions): Promise<MediaObject> {
        return this.createMediaObject(await this.getClient().jpegSnapshot(), 'image/jpeg');
    }

    async getUrlSettings(): Promise<Setting[]> {
        return [
            {
                key: 'rtspChannel',
                title: 'Channel Number Override',
                subgroup: 'Advanced',
                description: "The channel number to use for snapshots and video. E.g., 0, 1, 2, etc.",
                placeholder: '0',
                type: 'number',
                value: this.getRtspChannel(),
            },
            ...await super.getUrlSettings(),
        ]
    }

    getRtspChannel() {
        return parseInt(this.storage.getItem('rtspChannel')) || 0;
    }

    createRtspMediaStreamOptions(url: string, index: number) {
        const ret = super.createRtspMediaStreamOptions(url, index);
        ret.tool = 'scrypted';
        return ret;
    }

    async getConstructedVideoStreamOptions(): Promise<UrlMediaStreamOptions[]> {
        const ret: UrlMediaStreamOptions[] = [];

        const rtmpPreviews = [
            `main.bcs`,
            `ext.bcs`,
            `sub.bcs`,
        ];
        for (const preview of rtmpPreviews) {
            const url = new URL(`rtmp://${this.getRtmpAddress()}/bcs/channel${this.getRtspChannel()}_${preview}`);
            const params = url.searchParams;
            params.set('channel', this.getRtspChannel().toString());
            params.set('stream', '0');
            params.set('user', this.getUsername());
            params.set('password', this.getPassword());
            ret.push({
                name: `RTMP ${preview}`,
                id: preview,
                url: url.toString(),
            });
        }

        // rough guesses for rebroadcast stream selection.
        ret[0].container = 'rtmp';
        ret[0].video = {
            width: 2560,
            height: 1920,
        }
        ret[1].container = 'rtmp';
        ret[1].video = {
            width: 896,
            height: 672,
        }
        ret[2].container = 'rtmp';
        ret[2].video = {
            width: 640,
            height: 480,
        }

        const channel = (this.getRtspChannel() + 1).toString().padStart(2, '0');
        const rtspPreviews = [
            `h264Preview_${channel}_main`,
            `h264Preview_${channel}_sub`,
            `h265Preview_${channel}_main`,
        ];
        for (const preview of rtspPreviews) {
            ret.push({
                name: `RTSP ${preview}`,
                id: preview,
                url: `rtsp://${this.getRtspAddress()}/${preview}`,
                container: 'rtsp',
                video: {
                    codec: preview.substring(0, 4),
                },
            });
        }

        // rough guesses for h264
        ret[3].container = 'rtsp';
        ret[3].video = {
            codec: 'h264',
            width: 2560,
            height: 1920,
        }
        ret[4].container = 'rtsp';
        ret[4].video = {
            codec: 'h264',
            width: 896,
            height: 672,
        }

        ret[5].container = 'rtsp';
        ret[5].video = {
            codec: 'h265',
            width: 896,
            height: 672,
        }


        return ret;
    }

    async putSetting(key: string, value: string) {
        this.client = undefined;
        super.putSetting(key, value);
        this.updateDevice();
        this.updateManagementUrl();
    }

    showRtspUrlOverride() {
        return false;
    }

    async getRtspPortOverrideSettings(): Promise<Setting[]> {
        return [
            ...await super.getRtspPortOverrideSettings(),
            ...await this.storageSettings.getSettings(),
            {
                key: 'rtmpPort',
                subgroup: 'Advanced',
                title: 'RTMP Port Override',
                placeholder: '1935',
                value: this.storage.getItem('rtmpPort'),
            },
        ];
    }

    getRtmpAddress() {
        return `${this.getIPAddress()}:${this.storage.getItem('rtmpPort') || 1935}`;
    }
}

class ReolinkProider extends RtspProvider {
    getAdditionalInterfaces() {
        return [
            ScryptedInterface.Reboot,
            ScryptedInterface.VideoCameraConfiguration,
            ScryptedInterface.Camera,
            ScryptedInterface.AudioSensor,
            ScryptedInterface.MotionSensor,
        ];
    }

    async createDevice(settings: DeviceCreatorSettings, nativeId?: string): Promise<string> {
        const httpAddress = `${settings.ip}:${settings.httpPort || 80}`;
        let info: DeviceInformation = {};

        const username = settings.username?.toString();
        const password = settings.password?.toString();
        const doorbell = settings.doorbell?.toString();
        const skipValidate = settings.skipValidate === 'true';
        const rtspChannel = parseInt(settings.rtspChannel?.toString()) || 0;
        if (!skipValidate) {
            try {
                const api = new ReolinkCameraClient(httpAddress, username, password, rtspChannel, this.console);
                await api.jpegSnapshot();
                // there doesn't seem to be a way to get the actual model number information out of their api.
            }
            catch (e) {
                this.console.error('Error adding Reolink camera', e);
                throw e;
            }
        }
        settings.newCamera ||= 'Reolink Camera';

        nativeId = await super.createDevice(settings, nativeId);

        const device = await this.getDevice(nativeId) as ReolinkCamera;
        device.info = info;
        device.putSetting('username', username);
        device.putSetting('password', password);
        device.putSetting('doorbell', doorbell)
        device.setIPAddress(settings.ip?.toString());
        device.putSetting('rtspChannel', settings.rtspChannel?.toString());
        device.setHttpPortOverride(settings.httpPort?.toString());
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
                key: 'doorbell',
                title: 'Doorbell',
                description: 'This camera is a Reolink Doorbell.',
                type: 'boolean',
            },
            {
                key: 'rtspChannel',
                title: 'Channel Number Override',
                description: "Optional: The channel number to use for snapshots and video. E.g., 0, 1, 2, etc.",
                placeholder: '0',
                type: 'number',
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

    createCamera(nativeId: string) {
        return new ReolinkCamera(nativeId, this);
    }
}

export default ReolinkProider;
