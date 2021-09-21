import sdk, { MediaObject, Camera, ScryptedInterface } from "@scrypted/sdk";
import { Stream } from "stream";
import { AmcrestCameraClient, AmcrestEvent } from "./amcrest-api";
import { RtspSmartCamera, RtspProvider, Destroyable } from "../../rtsp/src/rtsp";
import { EventEmitter } from "stream";

const { mediaManager } = sdk;

class AmcrestCamera extends RtspSmartCamera implements Camera {
    eventStream: Stream;

    listenEvents() {
        const ret = new EventEmitter() as (EventEmitter & Destroyable);
        ret.destroy = () => {
        };
        (async () => {
            const api = this.createClient();
            try {
                const events = await api.listenEvents();
                ret.destroy = () => {
                    events.removeAllListeners();
                    events.destroy();
                };

                events.on('close', () => ret.emit('error', new Error('close')));
                events.on('error', e => ret.emit('error', e));
                events.on('event', (event: AmcrestEvent) => {
                    if (event === AmcrestEvent.MotionStart) {
                        this.motionDetected = true;
                    }
                    else if (event === AmcrestEvent.MotionStop) {
                        this.motionDetected = false;
                    }
                    else if (event === AmcrestEvent.AudioStart) {
                        this.audioDetected = true;
                    }
                    else if (event === AmcrestEvent.AudioStop) {
                        this.audioDetected = false;
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
        return new AmcrestCameraClient(this.storage.getItem('ip'), this.getUsername(), this.getPassword());
    }

    async takePicture(): Promise<MediaObject> {
        const api = this.createClient();
        return mediaManager.createMediaObject(api.jpegSnapshot(), 'image/jpeg');
    }

    async getConstructedStreamUrl() {
        return `rtsp://${this.getRtspAddress()}/cam/realmonitor?channel=1&subtype=0`;
    }
}

class AmcrestProvider extends RtspProvider {
    getAdditionalInterfaces() {
        return [
            ScryptedInterface.Camera,
            ScryptedInterface.AudioSensor,
            ScryptedInterface.MotionSensor,
        ];
    }

    getDevice(nativeId: string): object {
        return new AmcrestCamera(nativeId);
    }
}

export default new AmcrestProvider();
