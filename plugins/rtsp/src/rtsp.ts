import sdk, { ScryptedDeviceBase, DeviceProvider, Settings, Setting, ScryptedDeviceType, VideoCamera, MediaObject, VideoStreamOptions, ScryptedInterface } from "@scrypted/sdk";
const { log, deviceManager, mediaManager } = sdk;

export class RtspCamera extends ScryptedDeviceBase implements VideoCamera, Settings {

    constructor(nativeId: string) {
        super(nativeId);
    }
    async getVideoStreamOptions(): Promise<void | VideoStreamOptions[]> {
    }

    async getStreamUrl() {
        return this.storage.getItem("url");
    }

    async getVideoStream(): Promise<MediaObject> {
        const url = new URL(await this.getStreamUrl());
        url.username = this.storage.getItem("username")
        url.password = this.storage.getItem("password");

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
                url.toString(),
            ]
        });
    }

    async getUrlSettings() {
        return [
            {
                key: 'url',
                title: 'RTSP Stream URL',
                placeholder: 'rtsp://192.168.1.100:4567/foo/bar',
                value: this.storage.getItem('url'),
            },
        ];
    }

    getUsername() {
        return this.storage.getItem('username');
    }

    getPassword() {
        return this.storage.getItem('password');
    }

    async getSettings(): Promise<Setting[]> {
        return [
            ...await this.getUrlSettings(),
            {
                key: 'username',
                title: 'Username',
                value: this.getUsername(),
            },
            {
                key: 'password',
                title: 'Password',
                value: this.getPassword(),
                type: 'Password',
            }
        ];
    }

    async putSetting(key: string, value: string | number) {
        this.storage.setItem(key, value.toString());
    }
}

export class RtspProvider extends ScryptedDeviceBase implements DeviceProvider, Settings {
    async getSettings(): Promise<Setting[]> {
        return [
            {
                key: 'new-camera',
                title: 'Add RTSP Camera',
                placeholder: 'Camera name, e.g.: Back Yard Camera, Baby Camera, etc',
            }
        ]
    }

    getAdditionalInterfaces() {
        return [
        ];
    }

    async putSetting(key: string, value: string | number) {
        // generate a random id
        var nativeId = Math.random().toString();
        var name = value.toString();

        deviceManager.onDeviceDiscovered({
            nativeId,
            name: name,
            interfaces: [ScryptedInterface.VideoCamera,
            ScryptedInterface.Settings, ...this.getAdditionalInterfaces()],
            type: ScryptedDeviceType.Camera,
        });

        var text = `New Camera ${name} ready. Check the notification area to complete setup.`;
        log.a(text);
        log.clearAlert(text);
    }
    async discoverDevices(duration: number) {
    }

    getDevice(nativeId: string): object {
        return new RtspCamera(nativeId);
    }
}
