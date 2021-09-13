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
                console.error('event listener failure', e);
                await new Promise(resolve => setTimeout(resolve, 10000));
            }
        }
    }

    createClient() {
        const client = new HikVisionCameraAPI(this.getHttpAddress(), this.getUsername(), this.getPassword());

        (async() => {
            if (!await client.isH264Stream()) {
                this.log.a('This camera is configured for H.265 on the main channel. Configuring it it for H.264 is recommended for optimal performance.');
            }
        })();
        return client;
    }

    async takePicture(): Promise<MediaObject> {
        const api = this.createClient();
        return mediaManager.createMediaObject(api.jpegSnapshot(), 'image/jpeg');
    }

    async getStreamUrl() {
        return `rtsp://${this.getRtspAddress()}`;
    }
}

class HikVisionProvider extends RtspProvider {
    getAdditionalInterfaces() {
        return [
            ScryptedInterface.Camera,
            ScryptedInterface.AudioSensor,
            ScryptedInterface.MotionSensor,
        ];
    }

    getDevice(nativeId: string): object {
        return new HikVisionCamera(nativeId);
    }
}

export default new HikVisionProvider();
