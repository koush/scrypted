import sdk, { ScryptedDeviceBase, DeviceProvider, Settings, Setting, ScryptedDeviceType, VideoCamera, MediaObject, Device, MotionSensor, ScryptedInterface, Camera } from "@scrypted/sdk";
import { ProtectApi } from "./unifi-protect/src/protect-api";
import { ProtectApiUpdates, ProtectNvrUpdatePayloadCameraUpdate } from "./unifi-protect/src/protect-api-updates";

const { log, deviceManager, mediaManager } = sdk;

class RtspCamera extends ScryptedDeviceBase implements Camera, VideoCamera, MotionSensor, Settings {
    protect: UnifiProtect;
    activityTimeout: NodeJS.Timeout;

    constructor(protect: UnifiProtect, nativeId: string) {
        super(nativeId);
        this.protect = protect;

        this.motionDetected = false;
        if (this.interfaces.includes(ScryptedInterface.BinarySensor)) {
            this.binaryState = false;
        }
    }

    resetActivityTimeout() {
        clearTimeout(this.activityTimeout);
        this.activityTimeout = setTimeout(() => {
            this.motionDetected = false;
            if (this.interfaces.includes(ScryptedInterface.BinarySensor))
                this.binaryState = false;
        }, 30000);
    }

    async takePicture(): Promise<MediaObject> {
        const url = `https://${this.protect.getSetting('ip')}/proxy/protect/api/cameras/${this.nativeId}/snapshot?ts=${Date.now()}`

        const response = await this.protect.api.loginFetch(url);
        if (!response) {
            throw new Error('Unifi Protect login refresh failed.');
        }
        const data = await response.arrayBuffer();
        return mediaManager.createMediaObject(Buffer.from(data), 'image/jpeg');
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
    async getVideoStreamOptions() {
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

function protectLog(message, ...parameters: unknown[]) {

}

class UnifiProtect extends ScryptedDeviceBase implements Settings, DeviceProvider {
    authorization: string | undefined;
    accessKey: string | undefined;
    cameras: Map<string, RtspCamera> = new Map();
    api: ProtectApi;
    startup: Promise<void>;

    listener = (event: Buffer) => {
        const updatePacket = ProtectApiUpdates.decodeUpdatePacket(console, event);

        if (!updatePacket) {
            console.error("%s: Unable to process message from the realtime update events API.", this.api.getNvrName());
            return;
        }

        if (updatePacket.action.action !== "update") {
            return;
        }


        // Grab the right payload type, camera update payloads.
        const payload = updatePacket.payload as ProtectNvrUpdatePayloadCameraUpdate;

        if (!payload.isMotionDetected && !payload.lastRing) {
            return;
        }

        const rtsp = this.cameras.get(updatePacket.action.id);
        if (!rtsp) {
            // add it?
            return;
        }

        const camera = payload as any;

        if (camera.lastMotion && rtsp.storage.getItem('lastMotion') != camera.lastMotion) {
            rtsp.storage.setItem('lastMotion', camera.lastMotion.toString());
            rtsp.motionDetected = true;
            rtsp.resetActivityTimeout();
        }
        else if (rtsp.motionDetected && camera.lastSeen > camera.lastMotion + 30000) {
            rtsp.motionDetected = false;
        }

        if (camera.lastRing && rtsp.interfaces.includes(ScryptedInterface.BinarySensor) && rtsp.storage.getItem('lastRing') != camera.lastRing) {
            rtsp.storage.setItem('lastRing', camera.lastRing.toString());
            rtsp.binaryState = true;
            rtsp.resetActivityTimeout();
        }
        else if (rtsp.binaryState && camera.lastSeen > camera.lastRing + 30000) {
            rtsp.binaryState = false;
        }
    };

    constructor() {
        super();

        this.startup  =this.discoverDevices(0)
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

        if (!this.api) {
            this.api = new ProtectApi(protectLog, console, ip, username, password);
        }

        try {
            this.api.eventListener?.removeListener('message', this.listener);
            await this.api.refreshDevices();
            this.api.eventListener?.on('message', this.listener);
            this.api.eventListener?.on('close', async () => {
                this.log.e('Event Listener closed. Reconnecting in 10 seconds.');
                await new Promise(resolve => setTimeout(resolve, 10000));
                this.discoverDevices(0);
            })

            const devices: Device[] = [];

            if (!this.api.Cameras) {
                this.log.e('Cameras failed to load. Retrying in 10 seconds.');
                setTimeout(() => {
                    this.discoverDevices(0);
                }, 10000);
                return;
            }

            for (const camera of this.api.Cameras) {
                const rtspChannels = camera.channels.filter(channel => channel.isRtspEnabled)
                if (!rtspChannels.length) {
                    log.a(`RTSP is not enabled on the Unifi Camera: ${camera.name}`);
                    continue;
                }
                const rtspChannel = rtspChannels[0];

                const { rtspAlias } = rtspChannel;

                const d = {
                    name: camera.name,
                    nativeId: camera.id,
                    interfaces: [
                        // ScryptedInterface.Settings,
                        ScryptedInterface.Camera,
                        ScryptedInterface.VideoCamera,
                        ScryptedInterface.MotionSensor,
                    ],
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

            await deviceManager.onDevicesChanged({
                devices
            });

            for (const device of devices) {
                this.getDevice(device.nativeId);
            }
        }
        catch (e) {
            this.log.a(`login error: ${e}`);
        }
    }

    async getDevice(nativeId: string): Promise<any> {
        await this.startup;
        if (this.cameras.has(nativeId))
            return this.cameras.get(nativeId);
        const ret = new RtspCamera(this, nativeId);
        this.cameras.set(nativeId, ret);
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
