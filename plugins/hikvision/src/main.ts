import sdk, { MediaObject, Camera, ScryptedInterface } from "@scrypted/sdk";
import { EventEmitter } from "stream";
import { HikVisionCameraAPI } from "./hikvision-camera-api";
import { Destroyable, RtspMediaStreamOptions, RtspProvider, RtspSmartCamera } from "../../rtsp/src/rtsp";
import { HikVisionCameraEvent } from "./hikvision-camera-api";
const { mediaManager } = sdk;

class HikVisionCamera extends RtspSmartCamera implements Camera {
    hasCheckedCodec = false;
    channelIds: Promise<string[]>;
    client: HikVisionCameraAPI;

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
                events.on('event', (event: HikVisionCameraEvent, cameraNumber: string) => {
                    // if (this.getRtspChannel() && cameraNumber !== this.getCameraNumber()) {
                    //     return;
                    // }
                    if (event === HikVisionCameraEvent.MotionDetected
                        || event === HikVisionCameraEvent.LineDetection
                        || event === HikVisionCameraEvent.FieldDetection) {
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
        const client = new HikVisionCameraAPI(this.getHttpAddress(), this.getUsername(), this.getPassword(), this.getRtspChannel(), this.console);

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

    // getClient() {
    //     if (!this.client)
    //         this.client = this.createClient();
    //     return this.client;
    // }

    async takeSmartCameraPicture(): Promise<MediaObject> {
        const api = this.createClient();
        return mediaManager.createMediaObject(api.jpegSnapshot(), 'image/jpeg');
    }

    async getUrlSettings() {
        return [
            {
                key: 'rtspChannel',
                title: 'Channel Number',
                description: "Optional: The channel number to use for snapshots. E.g., 101, 201, etc. The camera portion, e.g., 1, 2, etc, will be used to construct the RTSP stream.",
                placeholder: '101',
                value: this.storage.getItem('rtspChannel'),
            },
            ...await super.getUrlSettings(),
            {
                key: 'rtspUrlParams',
                title: 'RTSP URL Parameters Override',
                description: "Optional: Override the RTSP URL parameters. E.g.: ?transportmode=unicast",
                placeholder: this.getRtspUrlParams(),
                value: this.storage.getItem('rtspUrlParams'),
            },
        ]
    }

    getRtspChannel() {
        return this.storage.getItem('rtspChannel');
    }

    getCameraNumber() {
        const channel = this.getRtspChannel();
        if (channel?.length > 3)
            return channel.substring(0, channel.length - 2);
        return channel?.substring(0, 1) || '1';
    }

    getRtspUrlParams() {
        return this.storage.getItem('rtspUrlParams') || '?transportmode=unicast';
    }

    async getConstructedVideoStreamOptions(): Promise<RtspMediaStreamOptions[]> {
        if (!this.channelIds) {
            const client = this.createClient();
            this.channelIds = new Promise(async (resolve, reject) => {
                try {

                    const response = await client.digestAuth.request({
                        url: `http://${this.getHttpAddress()}/ISAPI/Streaming/channels`,
                        responseType: 'text',
                    });
                    const xml: string = response.data;
                    const matches = xml.matchAll(/<id>(.*?)<\/id>/g);
                    const ids = [];
                    for (const m of matches) {
                        ids.push(m[1]);
                    }
                    resolve(ids);
                }
                catch (e) {
                    const cameraNumber = this.getCameraNumber() || '1';
                    this.console.error('error retrieving channel ids', e);
                    resolve([cameraNumber + '01', cameraNumber + '02']);
                    this.channelIds = undefined;
                }
            })
        }
        const channelIds = await this.channelIds;
        const params = this.getRtspUrlParams() || '?transportmode=unicast';

        // due to being able to override the channel number, and NVR providing per channel port access,
        // do not actually use these channel ids, and just use it to determine the number of channels
        // available for a camera.
        const ret = [];
        const cameraNumber = this.getCameraNumber() || '1';
        for (let index = 0; index < channelIds.length; index++) {
            const channel = (index + 1).toString().padStart(2, '0');
            const mso = this.createRtspMediaStreamOptions(`rtsp://${this.getRtspAddress()}/Streaming/Channels/${cameraNumber}${channel}/${params}`, index);
            ret.push(mso);
        }

        return ret;
    }

    showRtspUrlOverride() {
        return false;
    }

    async putSetting(key: string, value: string) {
        this.client = undefined;
        this.channelIds = undefined;
        super.putSetting(key, value);
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

        const key = `${address}#${username}#${password}`;
        const check = this.clients.get(key);
        if (check)
            return check;
        const client = new HikVisionCameraAPI(address, username, password, undefined, this.console);
        this.clients.set(key, client);
        return client;
    }

    createCamera(nativeId: string) {
        return new HikVisionCamera(nativeId, this);
    }
}

export default new HikVisionProvider();
