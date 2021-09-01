import sdk, { ScryptedDeviceBase, DeviceProvider, Settings, Setting, ScryptedDeviceType, VideoCamera, MediaObject, VideoStreamOptions, Camera, ScryptedInterface } from "@scrypted/sdk";
import { Stream } from "stream";
import { AmcrestCameraClient, AmcrestEvent } from "./amcrest-api";
const { log, deviceManager, mediaManager } = sdk;

class AmcrestCamera extends ScryptedDeviceBase implements VideoCamera, Camera, Settings {
    eventStream: Stream;

    constructor(nativeId: string) {
        super(nativeId);

        this.createMotionStream();
    }

    async createMotionStream() {
        while (true) {
            try {
                this.motionDetected = false;
                this.audioDetected = false;

                const api = new AmcrestCameraClient(this.storage.getItem('ip'), this.storage.getItem('username'), this.storage.getItem('password'));
                for await (const event of api.listenEvents()) {
                    if (event === AmcrestEvent.MotionStart)
                        this.motionDetected = true;
                    else if (event === AmcrestEvent.MotionStop)
                        this.motionDetected = false;
                    else if (event === AmcrestEvent.AudioStart)
                        this.audioDetected = true;
                    else if (event === AmcrestEvent.AudioStop)
                        this.audioDetected = false;
                }
            }
            catch (e) {
                console.error('event listener failure', e);
                await new Promise(resolve => setTimeout(resolve, 10000));
            }
        }
    }

    createClient() {
        return new AmcrestCameraClient(this.storage.getItem('ip'), this.storage.getItem('username'), this.storage.getItem('password'));
    }

    async takePicture(): Promise<MediaObject> {
        const api = new AmcrestCameraClient(this.storage.getItem('ip'), this.storage.getItem('username'), this.storage.getItem('password'));
        return mediaManager.createMediaObject(api.jpegSnapshot(), 'image/jpeg');
    }

    async getVideoStreamOptions(): Promise<void | VideoStreamOptions[]> {
    }
    async getVideoStream(): Promise<MediaObject> {
        const ip = this.storage.getItem('ip');
        if (!ip) {
            return null;
        }
        const username = this.storage.getItem("username")
        const password = this.storage.getItem("password");
        const url = `rtsp://${username}:${password}@${ip}/cam/realmonitor?channel=1&subtype=0`;

        return mediaManager.createFFmpegMediaObject({
            inputArguments: [
                "-i",
                url,
                '-analyzeduration', '15000000',
                '-probesize', '100000000',
                "-reorder_queue_size",
                "1024",
                "-max_delay",
                "20000000",
            ]
        });
    }
    getSetting(key: string): string {
        return this.storage.getItem(key);
    }
    async getSettings(): Promise<Setting[]> {
        return [
            {
                key: 'ip',
                title: 'Amcrest Camera IP',
                placeholder: '192.168.1.100',
                value: this.getSetting('ip'),
            },
            {
                key: 'username',
                title: 'Username',
                value: this.getSetting('username'),
            },
            {
                key: 'password',
                title: 'Password',
                value: this.getSetting('password'),
                type: 'Password',
            }
        ];
    }
    async putSetting(key: string, value: string | number) {
        this.storage.setItem(key, value.toString());
    }
}

class AmcrestProvider extends ScryptedDeviceBase implements DeviceProvider, Settings {
    async getSettings(): Promise<Setting[]> {
        return [
            {
                key: 'new-camera',
                title: 'Add Camera',
                placeholder: 'Camera name, e.g.: Back Yard Camera, Baby Camera, etc',
            }
        ]
    }
    async putSetting(key: string, value: string | number) {
        // generate a random id
        var nativeId = Math.random().toString();
        var name = value.toString();

        deviceManager.onDeviceDiscovered({
            nativeId,
            name: name,
            interfaces: [
                ScryptedInterface.VideoCamera,
                ScryptedInterface.Camera,
                ScryptedInterface.AudioSensor,
                ScryptedInterface.MotionSensor,
                ScryptedInterface.Settings,
            ],
            type: ScryptedDeviceType.Camera,
        });
    }
    async discoverDevices(duration: number) {
    }

    getDevice(nativeId: string): object {
        return new AmcrestCamera(nativeId);
    }
}

export default new AmcrestProvider();
