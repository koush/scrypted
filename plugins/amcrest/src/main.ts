import sdk, { MediaObject, Camera, ScryptedInterface, Setting, ScryptedDeviceType, Intercom, FFMpegInput, ScryptedMimeTypes } from "@scrypted/sdk";
import { Stream } from "stream";
import { AmcrestCameraClient, AmcrestEvent } from "./amcrest-api";
import { RtspSmartCamera, RtspProvider, Destroyable } from "../../rtsp/src/rtsp";
import { EventEmitter } from "stream";
import child_process, { ChildProcess } from 'child_process';
import { ffmpegLogInitialOutput } from '../../../common/src/media-helpers';
import net from 'net';
import { listenZeroCluster } from "../../../common/src/listen-cluster";

const { mediaManager } = sdk;

class AmcrestCamera extends RtspSmartCamera implements Camera, Intercom {
    eventStream: Stream;
    cp: ChildProcess;

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
                    else if (event === AmcrestEvent.TalkInvite
                        || event === AmcrestEvent.PhoneCallDetectStart
                        || event === AmcrestEvent.AlarmIPCStart) {
                        this.binaryState = true;
                    }
                    else if (event === AmcrestEvent.TalkHangup
                        || event === AmcrestEvent.PhoneCallDetectStop
                        || event === AmcrestEvent.AlarmIPCStop) {
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
            provider.updateDevice(this.nativeId, this.name, [...provider.getInterfaces(), ScryptedInterface.BinarySensor, ScryptedInterface.Intercom], ScryptedDeviceType.Doorbell);
        else
            provider.updateDevice(this.nativeId, this.name, provider.getInterfaces());
    }

    async startIntercom(media: MediaObject): Promise<void> {
        // not sure if this all works, since i don't actually have a doorbell.
        // good luck!

        const buffer = await mediaManager.convertMediaObjectToBuffer(media, ScryptedMimeTypes.FFmpegInput);
        const ffmpegInput = JSON.parse(buffer.toString()) as FFMpegInput;

        const args = ffmpegInput.inputArguments.slice();
        args.unshift('-hide_banner');

        const server = new net.Server(async (socket) => {
            server.close();

            const url = `http://${this.getHttpAddress()}/cgi-bin/audio.cgi?action=postAudio&httptype=singlepart&channel=1`;
            this.console.log('posting audio data to', url);

            const client = this.createClient();
            try {
                await client.digestAuth.request({
                    method: 'POST',
                    url,
                    headers: {
                        'Content-Type': 'Audio/G.711A',
                        'Content-Length': '9999999'
                    },
                    data: socket
                });
            }
            catch (e) {
                this.console.error('audio finished with error', e);
            }
            this.cp.kill();
        });
        const port = await listenZeroCluster(server)

        args.push(
            "-vn",
            "-f",
            "alaw",
            `tcp://127.0.0.1:${port}`,
        );

        const ffmpeg = await mediaManager.getFFmpegPath();
        this.cp = child_process.spawn(ffmpeg, args);
        this.cp.on('killed', () => this.cp = undefined);
        ffmpegLogInitialOutput(this.console, this.cp);
    }
    async stopIntercom(): Promise<void> {
        this.cp?.kill();
        this.cp = undefined;
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
        return new AmcrestCamera(nativeId, this);
    }
}

const provider = new AmcrestProvider();

export default provider;
