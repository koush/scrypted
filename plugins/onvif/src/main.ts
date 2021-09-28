import sdk, { MediaObject, Camera, ScryptedInterface } from "@scrypted/sdk";
import { EventEmitter, Stream } from "stream";
import { RtspSmartCamera, RtspProvider, Destroyable } from "../../rtsp/src/rtsp";
import { connectCameraAPI, OnvifCameraAPI, OnvifEvent } from "./onvif-api";

const { mediaManager } = sdk;


class OnvifCamera extends RtspSmartCamera {
    eventStream: Stream;
    client: OnvifCameraAPI;
    streamUrl: string;

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

    async takePicture(): Promise<MediaObject> {
        if (!this.client)
            this.client = await this.createClient();
        return mediaManager.createMediaObject(this.client.jpegSnapshot(), 'image/jpeg');
    }

    async getConstructedStreamUrl() {
        try {
            if (!this.streamUrl) {
                if (!this.client)
                this.client = await this.createClient();
                this.streamUrl = await this.client.getStreamUrl();
            }
            return this.streamUrl;
        }
        catch (e) {
            return `rtsp://${this.getRtspAddress()}/cam/realmonitor?channel=1&subtype=0`;
        }
    }

    putSetting(key: string, value: string) {
        this.client = undefined;
        this.streamUrl = undefined;
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
