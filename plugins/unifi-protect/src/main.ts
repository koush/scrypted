import sdk, { ScryptedDeviceBase, DeviceProvider, Settings, Setting, ScryptedDeviceType, VideoCamera, MediaObject, Device, MotionSensor, ScryptedInterface, Camera, VideoStreamOptions } from "@scrypted/sdk";
import { ProtectApi } from "./unifi-protect/src/protect-api";
import { ProtectApiUpdates, ProtectNvrUpdatePayloadCameraUpdate, ProtectNvrUpdatePayloadEventAdd } from "./unifi-protect/src/protect-api-updates";
import { ProtectCameraConfigInterface } from "./unifi-protect/src/protect-types";

const { log, deviceManager, mediaManager } = sdk;

class UnifiCamera extends ScryptedDeviceBase implements Camera, VideoCamera, MotionSensor {
    protect: UnifiProtect;
    motionTimeout: NodeJS.Timeout;
    ringTimeout: NodeJS.Timeout;
    lastMotion: number;
    lastRing: number;
    lastSeen: number;

    constructor(protect: UnifiProtect, nativeId: string, protectCamera: Readonly<ProtectCameraConfigInterface>) {
        super(nativeId);
        this.protect = protect;
        this.lastMotion = protectCamera?.lastMotion;
        this.lastRing = protectCamera?.lastRing;
        this.lastSeen = protectCamera?.lastSeen;

        this.motionDetected = false;
        if (this.interfaces.includes(ScryptedInterface.BinarySensor)) {
            this.binaryState = false;
        }
    }

    resetMotionTimeout() {
        clearTimeout(this.motionTimeout);
        this.motionTimeout = setTimeout(() => {
            this.motionDetected = false;
        }, 30000);
    }

    resetRingTimeout() {
        clearTimeout(this.ringTimeout);
        this.ringTimeout = setTimeout(() => {
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
        const camera = this.protect.api.Cameras.find(camera => camera.id === this.nativeId);
        const rtspChannels = camera.channels.filter(channel => channel.isRtspEnabled);
        const rtspChannel = rtspChannels[0];

        const { rtspAlias } = rtspChannel;
        const u = `rtsp://${this.protect.getSetting('ip')}:7447/${rtspAlias}`

        return mediaManager.createFFmpegMediaObject({
            inputArguments: [
                "-rtsp_transport",
                "tcp",
                '-analyzeduration', '15000000',
                '-probesize', '100000000',
                "-reorder_queue_size",
                "1024",
                "-max_delay",
                "20000000",
                "-i",
                u.toString(),
            ]
        });
    }
    async getVideoStreamOptions(): Promise<VideoStreamOptions[] | void> {
        const camera = this.protect.api.Cameras.find(camera => camera.id === this.nativeId);
        const video: VideoStreamOptions[] = camera.channels.map(channel => {
            return {
                video: {
                    name: channel.name,
                    codec: 'h264',
                    width: channel.width,
                    height: channel.height,
                    bitrate: channel.maxBitrate,
                    minBitrate: channel.minBitrate,
                    maxBitrate: channel.maxBitrate,
                    fps: channel.fps,
                    idrIntervalMillis: channel.idrInterval * 1000,
                }
            }
        });

        return video;
    }
}

class UnifiProtect extends ScryptedDeviceBase implements Settings, DeviceProvider {
    authorization: string | undefined;
    accessKey: string | undefined;
    cameras: Map<string, UnifiCamera> = new Map();
    api: ProtectApi;
    startup: Promise<void>;

    listener = (event: Buffer) => {
        const updatePacket = ProtectApiUpdates.decodeUpdatePacket(console, event);

        if (!updatePacket) {
            console.error("%s: Unable to process message from the realtime update events API.", this.api.getNvrName());
            return;
        }

        switch (updatePacket.action.modelKey) {
            case "camera": {

                // We listen for the following camera update actions:
                //   doorbell LCD updates
                //   doorbell rings
                //   motion detection

                // We're only interested in update actions.
                if (updatePacket.action.action !== "update") {
                    return;
                }

                // Grab the right payload type, camera update payloads.
                const payload = updatePacket.payload as ProtectNvrUpdatePayloadCameraUpdate;

                // Now filter out payloads we aren't interested in. We only want motion detection and doorbell rings for now.
                if (!payload.isMotionDetected && !payload.lastRing && !payload.lcdMessage) {
                    return;
                }

                // Lookup the accessory associated with this camera.
                const rtsp = this.cameras.get(updatePacket.action.id);

                // We don't know about this camera - we're done.
                if (!rtsp) {
                    return;
                }

                if (payload.isMotionDetected) {
                    rtsp.motionDetected = true;
                    rtsp.lastMotion = payload.lastMotion;
                    rtsp.resetMotionTimeout();
                }
                else if (rtsp.motionDetected && payload.lastSeen > payload.lastMotion + 30000) {
                    rtsp.motionDetected = false;
                }

                // It's a ring event - process it accordingly.
                if (payload.lastRing && rtsp.interfaces.includes(ScryptedInterface.BinarySensor) && rtsp.lastRing < payload.lastRing) {
                    rtsp.lastRing = payload.lastRing;
                    rtsp.binaryState = true;
                    rtsp.resetRingTimeout();
                }
                else if (rtsp.binaryState && payload.lastSeen > payload.lastRing + 30000) {
                    rtsp.binaryState = false;
                }

                // It's a doorbell LCD message event - process it accordingly.
                if (payload.lcdMessage) {
                }

                rtsp.lastSeen = payload.lastSeen;
                break;
            }
            case "event": {
                // We're only interested in add events.
                if (updatePacket.action.action !== "add") {
                    return;
                }

                // Grab the right payload type, for event add payloads.
                const payload = updatePacket.payload as ProtectNvrUpdatePayloadEventAdd;

                // We're only interested in smart motion detection events.
                if (payload.type !== "smartDetectZone") {
                    return;
                }

                // Lookup the accessory associated with this camera.
                const rtsp = this.cameras.get(payload.camera);

                // We don't know about this camera - we're done.
                if (!rtsp) {
                    return;
                }

                // It's a motion event - process it accordingly, but only if we're not configured for smart motion events - we handle those elsewhere.
                if (rtsp.lastMotion < payload.start) {
                    rtsp.motionDetected = true;
                    rtsp.lastMotion = payload.start;
                    rtsp.resetMotionTimeout();
                }
                else if (rtsp.motionDetected && rtsp.lastSeen > payload.start + 30000) {
                    rtsp.motionDetected = false;
                }

                rtsp.lastSeen = payload.start;
                break;
            }
        }

    };

    constructor() {
        super();

        this.startup = this.discoverDevices(0)
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
            this.api = new ProtectApi(console.log.bind(console), console, ip, username, password);
        }

        try {
            this.api.eventListener?.removeListener('message', this.listener);
            await this.api.refreshDevices();
            this.api.eventListener?.on('message', this.listener);
            this.api.eventListener?.on('close', async () => {
                this.console.error('Event Listener closed. Reconnecting in 10 seconds.');
                await new Promise(resolve => setTimeout(resolve, 10000));
                this.discoverDevices(0);
            })

            const devices: Device[] = [];

            if (!this.api.Cameras) {
                this.console.error('Cameras failed to load. Retrying in 10 seconds.');
                setTimeout(() => {
                    this.discoverDevices(0);
                }, 10000);
                return;
            }

            for (let camera of this.api.Cameras) {
                if (camera.isAdoptedByOther) {
                    this.console.log('skipping camera that is adopted by another nvr', camera.id, camera.name);
                    continue;
                }

                let needUpdate = false;
                for (const channel of camera.channels) {
                    if (channel.idrInterval !== 4 || !channel.isRtspEnabled) {
                        channel.idrInterval = 4;
                        channel.isRtspEnabled = true;
                        needUpdate = true;
                    }
                }

                if (needUpdate) {
                    camera = await this.api.updateChannels(camera);
                    if (!camera) {
                        this.log.a('Unable to enable RTSP and IDR interval on camera. Is this an admin account?');
                        continue;
                    }
                }

                const d: Device = {
                    name: camera.name,
                    nativeId: camera.id,
                    info: {
                        manufacturer: 'Ubiquiti',
                        model: camera.type,
                        firmware: camera.firmwareVersion,
                        version: camera.hardwareRevision,
                        serialNumber: camera.id,
                    },
                    interfaces: [
                        ScryptedInterface.Camera,
                        ScryptedInterface.VideoCamera,
                        ScryptedInterface.MotionSensor,
                    ],
                    type: ScryptedDeviceType.Camera,
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
            this.console.error('login error', e);
        }
    }

    async getDevice(nativeId: string): Promise<any> {
        await this.startup;
        if (this.cameras.has(nativeId))
            return this.cameras.get(nativeId);
        const ret = new UnifiCamera(this, nativeId, this.api.Cameras.find(camera => camera.id === nativeId));
        this.cameras.set(nativeId, ret);
        return ret;
    }

    getSetting(key: string): string {
        return this.storage.getItem(key);
    }
    async getSettings(): Promise<Setting[]> {
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
