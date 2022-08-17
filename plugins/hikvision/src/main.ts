import sdk, { MediaObject, Camera, ScryptedInterface } from "@scrypted/sdk";
import { EventEmitter } from "stream";
import { HikVisionCameraAPI } from "./hikvision-camera-api";
import { Destroyable, UrlMediaStreamOptions, RtspProvider, RtspSmartCamera } from "../../rtsp/src/rtsp";
import { sleep } from "../../../common/src/sleep";
import { HikVisionCameraEvent } from "./hikvision-camera-api";
const { mediaManager } = sdk;

class HikVisionCamera extends RtspSmartCamera implements Camera {
    channelIds: Promise<string[]>;
    client: HikVisionCameraAPI;

    // bad hack, but whatever.
    codecCheck = (async () => {
        while (true) {
            try {
                const streamSetup = await this.client.checkStreamSetup(this.getRtspChannel(), await this.isOld());
                if (streamSetup.videoCodecType !== 'H.264') {
                    this.log.a(`This camera is configured for ${streamSetup.videoCodecType} on the main channel. Configuring it it for H.264 is recommended for optimal performance.`);
                }
                if (!this.isAudioDisabled() && streamSetup.audioCodecType && streamSetup.audioCodecType !== 'AAC') {
                    this.log.a(`This camera is configured for ${streamSetup.audioCodecType} on the main channel. Configuring it for AAC is recommended for optimal performance.`);
                }
                break;
            }
            catch (e) {
                await sleep(60000);
            }
        }
    })();

    async listenEvents() {
        let motionTimeout: NodeJS.Timeout;
        const api = (this.provider as HikVisionProvider).createSharedClient(this.getHttpAddress(), this.getUsername(), this.getPassword());
        const events = await api.listenEvents();

        let ignoreCameraNumber: boolean;

        events.on('event', async (event: HikVisionCameraEvent, cameraNumber: string) => {
            if (event === HikVisionCameraEvent.MotionDetected
                || event === HikVisionCameraEvent.LineDetection
                || event === HikVisionCameraEvent.FieldDetection) {

                // check if the camera+channel field is in use, and filter events.
                if (this.getRtspChannel()) {
                    // it is possible to set it up to use a camera number
                    // on an nvr IP (which gives RTSP urls through the NVR), but then use a http port
                    // that gives a filtered event stream from only that camera.
                    // this this case, the camera numbers will not
                    // match as they will be always be "1".
                    // to detect that a camera specific endpoint is being used
                    // can look at the channel ids, and see if that camera number is found.
                    // this is different from the use case where the NVR or camera
                    // is using a port other than 80 (the default).
                    // could add a setting to have the user explicitly denote nvr usage
                    // but that is error prone.
                    const userCameraNumber = this.getCameraNumber();
                    if (ignoreCameraNumber === undefined && this.channelIds) {
                        const channelIds = await this.channelIds;
                        ignoreCameraNumber = true;
                        for (const id of channelIds) {
                            if (id.startsWith(userCameraNumber)) {
                                ignoreCameraNumber = false;
                                break;
                            }
                        }
                    }

                    if (!ignoreCameraNumber && cameraNumber !== userCameraNumber) {
                        // this.console.error(`### Skipping motion event ${cameraNumber} != ${this.getCameraNumber()}`);
                        return;
                    }
                }

                // this.console.error('### Detected motion, camera: ', cameraNumber);
                this.motionDetected = true;
                clearTimeout(motionTimeout);
                motionTimeout = setTimeout(() => this.motionDetected = false, 30000);
            }
        })

        return events;
    }

    createClient() {
        return new HikVisionCameraAPI(this.getHttpAddress(), this.getUsername(), this.getPassword(), this.console);
    }

    getClient() {
        if (!this.client)
            this.client = this.createClient();
        return this.client;
    }

    async takeSmartCameraPicture(): Promise<MediaObject> {
        const api = this.getClient();
        return mediaManager.createMediaObject(await api.jpegSnapshot(this.getRtspChannel()), 'image/jpeg');
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
        // have users with more than 10 cameras. unsure if it is possible
        // to have more than 10 substreams...
        if (channel?.length > 3)
            return channel.substring(0, channel.length - 2);
        return channel?.substring(0, 1) || '1';
    }

    getRtspUrlParams() {
        return this.storage.getItem('rtspUrlParams') || '?transportmode=unicast';
    }

    async isOld() {
        const client = this.getClient();
        let isOld: boolean;
        if (this.storage.getItem('isOld')) {
            isOld = this.storage.getItem('isOld') === 'true';
        }
        else {
            isOld = await client.checkIsOldModel();
            this.storage.setItem('isOld', isOld?.toString());
        }
        return isOld;
    }

    async getConstructedVideoStreamOptions(): Promise<UrlMediaStreamOptions[]> {
        if (!this.channelIds) {
            const client = this.getClient();
            this.channelIds = new Promise(async (resolve, reject) => {
                const isOld = await this.isOld();

                if (isOld) {
                    this.console.error('Old NVR. Defaulting to two camera configuration');
                    const camNumber = this.getCameraNumber() || '1';
                    resolve([camNumber + '01', camNumber + '02']);
                } else try {
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
            const mso = this.createRtspMediaStreamOptions(`rtsp://${this.getRtspAddress()}/ISAPI/Streaming/channels/${cameraNumber}${channel}/${params}`, index);
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
        const client = new HikVisionCameraAPI(address, username, password, this.console);
        this.clients.set(key, client);
        return client;
    }

    createCamera(nativeId: string) {
        return new HikVisionCamera(nativeId, this);
    }
}

export default new HikVisionProvider();
