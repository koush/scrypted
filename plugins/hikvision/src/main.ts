import sdk, { MediaObject, Camera, ScryptedInterface } from "@scrypted/sdk";
import { EventEmitter } from "stream";
import { HikVisionCameraAPI } from "./hikvision-camera-api";
import { Destroyable, RtspProvider, RtspSmartCamera } from "../../rtsp/src/rtsp";
import { HikVisionCameraEvent } from "./hikvision-camera-api";
const { mediaManager } = sdk;

class HikVisionCamera extends RtspSmartCamera implements Camera {
    hasCheckedCodec = false;

    listenEvents() {
        let motionTimeout: NodeJS.Timeout;
        const ret = new EventEmitter() as (EventEmitter & Destroyable);
        ret.destroy = () => {
        };
        (async () => {
            const api = (this.provider as HikVisionProvider).createSharedClient(this.getHttpAddress(), this.getUsername(), this.getPassword());
            try {
                const events = await api.listenEvents();
                ret.destroy = () => {
                    events.removeAllListeners();
                };

                events.on('close', () => ret.emit('error', new Error('close')));
                events.on('error', e => ret.emit('error', e));
                events.on('event', (event: HikVisionCameraEvent, channel: string) => {
                    if (this.getRtspChannel() && channel !== this.getRtspChannel().substr(0, 1)) {
                        return;
                    }
                    if (event === HikVisionCameraEvent.MotionDetected) {
                        this.motionDetected = true;
                        clearTimeout(motionTimeout);
                        motionTimeout = setTimeout(() => this.motionDetected = false, 30000);
                    }
                })
            }
            catch (e) {
                ret.emit('error', e);
            }
        })();
        return ret;
    }

    createClient() {
        const client = new HikVisionCameraAPI(this.getHttpAddress(), this.getUsername(), this.getPassword(), this.getRtspChannel());

        (async () => {
            if (this.hasCheckedCodec)
                return;
            const streamSetup = await client.checkStreamSetup();
            this.hasCheckedCodec = true;
            if (streamSetup.videoCodecType !== 'H.264') {
                this.log.a(`This camera is configured for ${streamSetup.videoCodecType} on the main channel. Configuring it it for H.264 is recommended for optimal performance.`);
            }
            if (!this.isAudioDisabled() && streamSetup.audioCodecType && streamSetup.audioCodecType !== 'AAC') {
                this.log.a(`This camera is configured for ${streamSetup.audioCodecType} on the main channel. Configuring it it for AAC is recommended for optimal performance.`);
            }
        })();

        return client;
    }

    async takePicture(): Promise<MediaObject> {
        const api = this.createClient();

        return mediaManager.createMediaObject(api.jpegSnapshot(), 'image/jpeg');
    }

    async getUrlSettings() {
        return [
            ...await super.getUrlSettings(),
            {
                key: 'rtspChannel',
                title: 'Channel number',
                description: "What channel does this camera use?",
                placeholder: '1/2/3/etc.',
                value: this.storage.getItem('rtspChannel'),
            },
            {
                key: 'rtspUrlParams',
                title: 'RTSP URL Params Override',
                description: "Override the RTSP URL parameters - ?transportmode=unicast&...",
                placeholder: '?transportmode=unicast&...',
                value: this.storage.getItem('rtspUrlParams'),
            },
        ]
    }

    getRtspChannel() {
        return this.storage.getItem('rtspChannel');
    }

    getRtspUrlParams() {
        return this.storage.getItem('rtspUrlParams');
    }

    async getConstructedStreamUrl() {
        const channel = this.getRtspChannel() || '101';
        const params = this.getRtspUrlParams() || '?transportmode=unicast';
        return `rtsp://${this.getRtspAddress()}/Streaming/Channels/${channel}/${params}`;
    }
}

class HikVisionProvider extends RtspProvider {
    clients: Map<string, HikVisionCameraAPI>;

    constructor() {
        super();
    }

    getAdditionalInterfaces() {
        return [
            ScryptedInterface.Camera,
            ScryptedInterface.MotionSensor,
        ];
    }

    createSharedClient(address: string, username: string, password: string) {
        if (!this.clients)
            this.clients = new Map();

        const check = this.clients.get(address);
        if (check)
            return check;
        const client = new HikVisionCameraAPI(address, username, password);
        this.clients.set(address, client);
        return client;
    }

    createCamera(nativeId: string) {
        return new HikVisionCamera(nativeId, this);
    }
}

export default new HikVisionProvider();
