import sdk, { MediaObject, Camera, ScryptedInterface, MediaStreamOptions, PictureOptions } from "@scrypted/sdk";
import { EventEmitter, Stream } from "stream";
import { RtspSmartCamera, RtspProvider, Destroyable } from "../../rtsp/src/rtsp";
import { connectCameraAPI, OnvifCameraAPI, OnvifEvent } from "./onvif-api";

const { mediaManager } = sdk;

function computeInterval(fps: number, govLength: number) {
    if (!fps || !govLength)
        return;
    return govLength / fps * 1000;
}

function computeBitrate(bitrate: number) {
    if (!bitrate)
        return;
    return bitrate * 1000;
}

function convertAudioCodec(codec: string) {
    if (codec === 'MP4A-LATM')
        return 'aac';
    return codec;
}

class OnvifCamera extends RtspSmartCamera {
    eventStream: Stream;
    client: OnvifCameraAPI;

    async getPictureOptions?(): Promise<PictureOptions[]> {
        try {
            const vso = await this.getVideoStreamOptions();
            const ret = vso.map(({ id, name, video }) => ({
                id,
                name,
                // onvif doesn't actually specify the snapshot dimensions for a profile.
                // it may just send whatever.
                picture: {
                    width: video?.width,
                    height: video?.height,
                }
            }));
            return ret;
        }
        catch (e) {
        }
    }

    async getVideoStreamOptions(): Promise<MediaStreamOptions[]> {
        try {
            const client = await this.getClient();
            const profiles: any[] = await client.getProfiles();
            const ret: MediaStreamOptions[] = profiles.map(({ $, name, videoEncoderConfiguration, audioEncoderConfiguration }) => ({
                id: $.token,
                name: name,
                video: {
                    fps: videoEncoderConfiguration?.rateControl?.frameRateLimit,
                    bitrate: computeBitrate(videoEncoderConfiguration?.rateControl?.bitrateLimit),
                    width: videoEncoderConfiguration?.resolution?.width,
                    height: videoEncoderConfiguration?.resolution?.height,
                    codec: videoEncoderConfiguration?.encoding?.toLowerCase(),
                    idrIntervalMillis: computeInterval(videoEncoderConfiguration?.rateControl?.frameRateLimit,
                        videoEncoderConfiguration?.$.GovLength),
                },
                audio: this.isAudioDisabled() ? null : {
                    bitrate: computeBitrate(audioEncoderConfiguration?.bitrate),
                    codec: convertAudioCodec(audioEncoderConfiguration?.encoding),
                }
            }))
            return ret;
        }
        catch (e) {
            return [
                {
                    video: {
                    },
                    audio: this.isAudioDisabled() ? null : {},
                }
            ];
        }
    }

    listenEvents(): EventEmitter & Destroyable {
        let motionTimeout: NodeJS.Timeout;

        (async () => {
            const client = await this.createClient();
            const events = client.listenEvents();
            events.on('event', event => {
                if (event === OnvifEvent.MotionBuggy) {
                    this.motionDetected = true;
                    clearTimeout(motionTimeout);
                    motionTimeout = setTimeout(() => this.motionDetected = false, 30000);
                    return;
                }

                if (event === OnvifEvent.MotionStart)
                    this.motionDetected = true;
                else if (event === OnvifEvent.MotionStop)
                    this.motionDetected = false;
                else if (event === OnvifEvent.AudioStart)
                    this.audioDetected = true;
                else if (event === OnvifEvent.AudioStop)
                    this.audioDetected = false;
            })
        })();
        const ret: any = new EventEmitter();
        ret.destroy = () => {
        };
        return ret;
    }

    createClient() {
        return connectCameraAPI(this.getRtspAddress(), this.getUsername(), this.getPassword(), this.console);
    }

    async getClient() {
        if (!this.client)
            this.client = await this.createClient();
        return this.client;
    }

    showRtspUrlOverride() {
        return false;
    }

    async takePicture(options?: PictureOptions): Promise<MediaObject> {
        const client = await this.getClient();
        // if no id is provided, choose the first available/enabled profile
        if (!options?.id) {
            try {
                const vsos = await this.getVideoStreamOptions();
                const vso = vsos.find(vso => this.isChannelEnabled(vso.id));
                return mediaManager.createMediaObject(client.jpegSnapshot(vso?.id), 'image/jpeg');
            }
            catch (e) {
            }
        }

        return mediaManager.createMediaObject(client.jpegSnapshot(options?.id), 'image/jpeg');
    }

    async getConstructedStreamUrl(options?: MediaStreamOptions) {
        const client = await this.getClient();
        // if no id is provided, choose the first available/enabled profile
        if (!options?.id) {
            try {
                const vsos = await this.getVideoStreamOptions();
                const vso = vsos.find(vso => this.isChannelEnabled(vso.id));
                return client.getStreamUrl(vso?.id);
            }
            catch (e) {
            }
        }
        return client.getStreamUrl(options?.id);
    }

    putSetting(key: string, value: string) {
        this.client = undefined;
        return super.putSetting(key, value);
    }
}

class OnvifProvider extends RtspProvider {
    getAdditionalInterfaces() {
        return [
            ScryptedInterface.Camera,
            ScryptedInterface.AudioSensor,
            ScryptedInterface.MotionSensor,
        ];
    }

    getDevice(nativeId: string): object {
        return new OnvifCamera(nativeId, this);
    }
}

export default new OnvifProvider();
