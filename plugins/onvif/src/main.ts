import sdk, { MediaObject, Camera, ScryptedInterface } from "@scrypted/sdk";
import { EventEmitter, Stream } from "stream";
import { RtspSmartCamera, RtspProvider, Destroyable } from "../../rtsp/src/rtsp";
import { connectCameraAPI, OnvifEvent } from "./onvif-api";

const { mediaManager } = sdk;


class OnvifCamera extends RtspSmartCamera {
    eventStream: Stream;
    listenEvents(): EventEmitter & Destroyable {
        (async () => {
            const client = await this.createClient();
            const events = client.listenEvents();
            events.on('event', event => {
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
        return connectCameraAPI(this.storage.getItem('ip'), this.getUsername(), this.getPassword());
    }

    async takePicture(): Promise<MediaObject> {
        const api = await this.createClient();
        return mediaManager.createMediaObject(api.jpegSnapshot(), 'image/jpeg');
    }

    async getConstructedStreamUrl() {
        return `rtsp://${this.getRtspAddress()}/cam/realmonitor?channel=1&subtype=0`;
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
        return new OnvifCamera(nativeId);
    }
}

export default new OnvifProvider();
