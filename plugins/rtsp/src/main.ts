import sdk, { ScryptedDeviceBase, DeviceProvider, Settings, Setting, ScryptedDeviceType, VideoCamera, MediaObject } from "@scrypted/sdk";
const { log, deviceManager, mediaManager } = sdk;
var Url = require('url-parse');

class RtspCamera extends ScryptedDeviceBase implements VideoCamera, Settings {

    constructor(nativeId: string) {
        super(nativeId);
    }
    async getVideoStream(): Promise<MediaObject> {
        var u = this.storage.getItem("url");
        if (u == null) {
            return null;
        }
        const url = new Url(u);
        url.username = this.storage.getItem("username")
        url.password = this.storage.getItem("password");

        return mediaManager.createFFmpegMediaObject({
            inputArguments: [
                "-i",
                url.toString(),
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
                key: 'url',
                title: 'RTSP Stream URL',
                placeholder: 'rtsp://192.168.1.100:4567/foo/bar',
                value: this.getSetting('url'),
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

class RtspProvider extends ScryptedDeviceBase implements DeviceProvider, Settings {
    constructor() {
        super();
        const deviceIds = deviceManager.getNativeIds();
        for (const nativeId of deviceIds) {
            if (nativeId) {
                deviceManager.onDeviceDiscovered({
                    nativeId,
                    interfaces: ["VideoCamera", "Settings"],
                    type: ScryptedDeviceType.Camera,
                });
            }
        }
    }

    getSetting(key: string): string | number {
        return null;
    }
    async getSettings(): Promise<Setting[]> {
        return [
            {
                key: 'new-camera',
                title: 'Add RTSP Camera',
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
            interfaces: ["VideoCamera", "Settings"],
            type: ScryptedDeviceType.Camera,
        });

        var text = `New RTSP Camera ${name} ready. Check the notification area to complete setup.`;
        log.a(text);
        log.clearAlert(text);
    }
    async discoverDevices(duration: number) {
    }

    getDevice(nativeId: string): object {
        return new RtspCamera(nativeId);
    }
}

export default new RtspProvider();
