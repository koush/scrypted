import sdk, { MediaObject, Camera, ScryptedInterface, Setting, ScryptedDeviceType } from "@scrypted/sdk";
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
                    else if (event === AmcrestEvent.TalkInvite) {
                        this.binaryState = true;
                    }
                    else if (event === AmcrestEvent.TalkHangup) {
                        this.binaryState = false;
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
        return new AmcrestCameraClient(this.storage.getItem('ip'), this.getUsername(), this.getPassword(), this.console);
    }

    async getOtherSettings(): Promise<Setting[]> {
        return [
            {
                title: 'Amcrest Doorbell',
                type: 'boolean',
                description: "Enable if this device is an Amcrest Doorbell.",
                key: "amcrestDoorbell",
                value: (!!this.providedInterfaces?.includes(ScryptedInterface.BinarySensor)).toString(),
            }
        ];
    }

    async takePicture(): Promise<MediaObject> {
        const api = this.createClient();
        return mediaManager.createMediaObject(api.jpegSnapshot(), 'image/jpeg');
    }

    async getConstructedStreamUrl() {
        return `rtsp://${this.getRtspAddress()}/cam/realmonitor?channel=1&subtype=0`;
    }

    async putSetting(key: string, value: string) {
        if (key !== 'amcrestDoorbell')
            return super.putSetting(key, value);

        this.storage.setItem(key, value);
        if (value === 'true')
            provider.updateDevice(this.nativeId, this.name, [...provider.getInterfaces(), ScryptedInterface.BinarySensor], ScryptedDeviceType.Doorbell);
        else
            provider.updateDevice(this.nativeId, this.name, provider.getInterfaces());
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

const provider = new AmcrestProvider();

export default provider;
