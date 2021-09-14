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

    isAudioDisabled() {
        return this.storage.getItem('noAudio') === 'true';
    }

    async getVideoStream(): Promise<MediaObject> {
        const url = new URL(await this.getStreamUrl());
        url.username = this.storage.getItem("username")
        url.password = this.storage.getItem("password");

        const ret = {
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
        };


        if (this.isAudioDisabled()) {
            ret.inputArguments.push(
                '-f', 'lavfi', '-i', 'anullsrc',
            );
        }

        return mediaManager.createFFmpegMediaObject(ret);
    }

    async getUrlSettings(): Promise<Setting[]> {
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
            },
            {
                key: 'noAudio',
                title: 'No Audio',
                description: 'Enable this setting if this camera does not have an audio stream.',
                type: 'boolean',
                value: (this.isAudioDisabled()).toString(),
            }
        ];
    }

    async putSetting(key: string, value: string | number) {
        this.storage.setItem(key, value.toString());
    }
}

export abstract class RtspSmartCamera extends RtspCamera {
    async getUrlSettings() {
        const constructed = await this.getConstructedStreamUrl();
        return [
            {
                key: 'ip',
                title: 'Address',
                placeholder: '192.168.1.100',
                value: this.storage.getItem('ip'),
            },
            {
                key: 'httpPort',
                title: 'HTTP Port Override',
                placeholder: '80',
                value: this.storage.getItem('httpPort'),
            },
            {
                key: 'rtspUrlOverride',
                title: 'RTSP URL Override',
                description: "Override the RTSP URL if your camera is using a non default port, channel, or rebroadcasted through an NVR. Default: " + constructed,
                placeholder: constructed,
                value: this.storage.getItem('rtspUrlOverride'),
            },
        ];
    }

    getHttpAddress() {
        return `${this.storage.getItem('ip')}:${this.storage.getItem('httpPort') || 80}`;
    }

    getRtspUrlOverride() {
        return this.storage.getItem('rtspUrlOverride');
    }

    abstract getConstructedStreamUrl(): Promise<string>;

    getRtspAddress() {
        return `${this.storage.getItem('ip')}:${this.storage.getItem('rtspPort') || 554}`;
    }

    async getStreamUrl() {
        return this.getRtspUrlOverride() || await this.getConstructedStreamUrl();
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
