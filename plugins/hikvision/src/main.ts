import sdk, { MediaObject, Camera, ScryptedInterface } from "@scrypted/sdk";
import { Stream } from "stream";
import { HikVisionCameraAPI } from "./hikvision-camera-api";
import { RtspProvider, RtspSmartCamera } from "../../rtsp/src/rtsp";
import { HikVisionCameraEvent } from "./hikvision-camera-api";
const { mediaManager } = sdk;


class HikVisionCamera extends RtspSmartCamera implements Camera {
    eventStream: Stream;
    motionTimeout: NodeJS.Timeout;

    constructor(nativeId: string) {
        super(nativeId);

        this.createMotionStream();
    }

    async createMotionStream() {
        while (true) {
            try {
                this.motionDetected = false;
                this.audioDetected = false;

                const api = this.createClient();
                for await (const event of api.listenEvents()) {
                    if (event === HikVisionCameraEvent.MotionDetected) {
                        this.motionDetected = true;
                        clearTimeout(this.motionTimeout);
                        this.motionTimeout = setTimeout(() => this.motionDetected = false, 30000);
                    }
                }
            }
            catch (e) {
                this.console.error('event listener failure', e);
                await new Promise(resolve => setTimeout(resolve, 10000));
                this.console.log('reconnecting to event stream...');
            }
        }
    }

    createClient() {
        const client = new HikVisionCameraAPI(this.getHttpAddress(), this.getUsername(), this.getPassword());

        (async() => {
            const streamSetup = await client.checkStreamSetup();
            if (streamSetup.videoCodecType !== 'H.264') {
                this.log.a(`This camera is configured for ${streamSetup.videoCodecType} on the main channel. Configuring it it for H.264 is recommended for optimal performance.`);
            }
            if (!this.isAudioDisabled() && streamSetup.audioCodecType !== 'AAC') {
                this.log.a(`This camera is configured for ${streamSetup.audioCodecType} on the main channel. Configuring it it for AAC is recommended for optimal performance.`);
            }
        })();
        return client;
    }

    async takePicture(): Promise<MediaObject> {
        const api = this.createClient();
        return mediaManager.createMediaObject(api.jpegSnapshot(), 'image/jpeg');
    }

    async getConstructedStreamUrl() {
        return `rtsp://${this.getRtspAddress()}/Streaming/Channels/101/?transportmode=unicast`;
    }
}

class HikVisionProvider extends RtspProvider {
    getAdditionalInterfaces() {
        return [
            ScryptedInterface.Camera,
            ScryptedInterface.MotionSensor,
        ];
    }

    getDevice(nativeId: string): object {
        return new HikVisionCamera(nativeId);
    }
}

export default new HikVisionProvider();
