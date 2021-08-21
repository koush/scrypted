import sdk, { ScryptedDeviceBase, DeviceProvider, Settings, Setting, ScryptedDeviceType, VideoCamera, MediaObject, DeviceManifest, Device, MotionSensor, Refresh, ScryptedInterfaceDescriptors, ScryptedInterface, Camera } from "@scrypted/sdk";
import axios, { AxiosResponse, AxiosRequestConfig, AxiosPromise } from 'axios';
import throttle from 'lodash/throttle';
import https from 'https';
import Buffer from 'buffer';

const { log, deviceManager, mediaManager } = sdk;

const httpsAgent = new https.Agent({  
    rejectUnauthorized: false
})

class RtspCamera extends ScryptedDeviceBase implements Camera, VideoCamera, MotionSensor, Refresh, Settings {
    protect: UnifiProtect;

    constructor(protect: UnifiProtect, nativeId: string) {
        super(nativeId);
        this.protect = protect;
    }
    async takePicture(): Promise<MediaObject> {
        const url = `https://${this.protect.getSetting('ip')}/proxy/protect/api/cameras/${this.nativeId}/snapshot?ts=${Date.now()}`
        // this.log.i(`fetching picture url: ${url}`);
        const promise: Promise<Buffer> = this.protect.getRetryAuth({
            url,
            httpsAgent,
            responseType: 'arraybuffer',
        })
        .then(response => {
            // this.log.i(`fetched ${response.data.length} bytes`);
            return response.data
        })
        return mediaManager.createMediaObject(promise, 'image/jpeg');
    }
    async getRefreshFrequency(): Promise<number> {
        return 1;
    }
    async refresh(refreshInterface: string, userInitiated: boolean) {
        this.protect.refresh();
    }
    async getVideoStream(): Promise<MediaObject> {
        var u = this.metadata.rtsp;
        if (u == null) {
            return null;
        }

        return mediaManager.createFFmpegMediaObject({
            inputArguments: [
                "-rtsp_transport",
                "tcp",
                "-i",
                u.toString(),
                '-analyzeduration', '15000000',
                '-probesize', '100000000',
                "-reorder_queue_size",
                "1024",
                "-max_delay",
                "20000000",
            ]
        });
    }
    getSetting(key: string): string | number {
        return this.storage.getItem(key);
    }
    async getSettings(): Promise<Setting[]> {
        return [
            {
                key: 'ffmpeg',
                title: 'Force FFMPEG',
                value: this.getSetting('ffmpeg')?.toString(),
                description: "Use ffmpeg instead of built in RTSP decoder.",
                type: 'Boolean',
            }
        ];
    }
    async putSetting(key: string, value: string | number) {
        this.storage.setItem(key, value.toString());
    }
}


class UnifiProtect extends ScryptedDeviceBase implements Settings, DeviceProvider {
    authorization: string|undefined;
    accessKey: string|undefined;
    cameras: Map<string, RtspCamera> = new Map();

    constructor() {
        super();

        this.discoverDevices(0)
    }

    refreshThrottle = throttle(async () => {
        const {cameras} = await this.getState();
        for (const camera of cameras) {
            const rtsp = this.cameras.get(camera.id);
            if (!rtsp)
                continue;
            if (rtsp.storage.getItem('lastMotion') != camera.lastMotion) {
                rtsp.storage.setItem('lastMotion', camera.lastMotion.toString());
                rtsp.motionDetected = true;
            }
            else if (rtsp.motionDetected && camera.lastSeen > camera.lastMotion + 30000) {
                rtsp.motionDetected = false;
            }

            if (rtsp.storage.getItem('lastRing') != camera.lastRing) {
                rtsp.storage.setItem('lastRing', camera.lastRing.toString());
                rtsp.binaryState = true;
            }
            else if (rtsp.binaryState && camera.lastSeen > camera.lastRing + 30000) {
                rtsp.binaryState = false;
            }
        }
    }, 1000);

    async refresh() {
        this.refreshThrottle();
    }

    async getWithAuth(u: string): Promise<AxiosResponse> {
        return axios(u, {
            httpsAgent,
            headers: {
                Cookie: this.authorization
            }
        });
    }

    async refreshAuth() {
        const ip = this.getSetting('ip');
        const username = this.getSetting('username');
        const password = this.getSetting('password');
        const authResponse = await axios.post(`https://${ip}/api/auth/login`, {
            username,
            password,
        }, {
            httpsAgent,
            headers: {
                Origin: `https://${ip}`,
                'Content-Type': 'application/json; charset=utf-8',
            }
        });

        const auth = authResponse.headers['set-cookie'];
        if (auth instanceof Array)
            this.authorization = auth[0]
        else
            this.authorization = auth;
    }

    getRetryAuth<T = any>(config: AxiosRequestConfig): AxiosPromise<T> {
        config.headers = Object.assign({}, config.headers, {
            Cookie: this.authorization
        });

        return axios(config)
        .catch(e => {
            if ((!e.response || e.response.status !== 401) && this.authorization)
                throw e;

            return this.refreshAuth()
            .then(() => {
                config.headers = Object.assign({}, config.headers, {
                    Cookie: this.authorization
                });
            
                return axios(config);
            })
        });
    }

    async getState(): Promise<any> {
        const ip = this.getSetting('ip');

        const bootstrapResponse = await this.getRetryAuth({
            url: `https://${ip}/proxy/protect/api/bootstrap`,
            httpsAgent,
            headers: {
                Cookie: this.authorization
            }
        });

        const {accessKey} = bootstrapResponse.data;
        this.accessKey = accessKey;
        return bootstrapResponse.data;
    }

    async discoverDevices(duration: number) {
        const ip = this.getSetting('ip');
        const username = this.getSetting('username');
        const password = this.getSetting('password');

        this.log.clearAlerts();

        if (!ip) {
            this.log.a('Must provide IP address.');
            return
        }

        if (!username) {
            this.log.a('Must provide username.');
            return
        }

        if (!password) {
            this.log.a('Must provide password.');
            return
        }

        try {
            const {cameras} = await this.getState();

            const devices: Device[] = [];
            
            for (const camera of cameras) {
                const rtspChannels = camera.channels.filter(channel => channel.isRtspEnabled)
                if (!rtspChannels.length) {
                    log.a(`RTSP is not enabled on the Unifi Camera: ${camera.name}`);
                    continue;
                }
                const rtspChannel = rtspChannels[0];

                const {rtspAlias} = rtspChannel;

                const d = {
                    name: camera.name,
                    nativeId: camera.id,
                    interfaces: [
                        // ScryptedInterface.Settings,
                        ScryptedInterface.Camera,
                        ScryptedInterface.VideoCamera,
                        ScryptedInterface.MotionSensor,
                        ScryptedInterface.Refresh],
                    type: ScryptedDeviceType.Camera,
                    metadata: {
                        rtsp: `rtsp://${ip}:7447/${rtspAlias}`
                    }
                };
                if (camera.featureFlags.hasChime) {
                    d.interfaces.push(ScryptedInterface.BinarySensor);
                }
                devices.push(d);
            }

            deviceManager.onDevicesChanged({
                devices
            })
        }
        catch (e) {
            this.log.a(`login error: ${e}`);
        }
    }

    getDevice(nativeId: string): object {
        if (this.cameras.has(nativeId))
            return this.cameras.get(nativeId);
        const ret = new RtspCamera(this, nativeId);
        this.cameras.set(nativeId, ret);
        this.refresh();
        return ret;
    }

    getSetting(key: string): string {
        return this.storage.getItem(key);
    }
    async getSettings(): Promise<Setting[]> {
        this.log.i('getting settings');
        return [
            {
                key: 'ip',
                title: 'Unifi Protect IP',
                placeholder: '192.168.1.100',
                value: this.getSetting('ip') || '',
            },
            {
                key: 'username',
                title: 'Username',
                value: this.getSetting('username') || '',
            },
            {
                key: 'password',
                title: 'Password',
                type: 'Password',
                value: this.getSetting('password') || '',
            },
        ];
    }
    async putSetting(key: string, value: string | number) {
        this.storage.setItem(key, value.toString());
        this.discoverDevices(0);
    }
}

export default new UnifiProtect();
