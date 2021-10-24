import sdk, { MediaObject, Camera, ScryptedInterface, Setting, ScryptedDeviceType, Intercom, FFMpegInput, ScryptedMimeTypes, PictureOptions } from "@scrypted/sdk";
import { Stream } from "stream";
import { AmcrestCameraClient, AmcrestEvent } from "./amcrest-api";
import { RtspSmartCamera, RtspProvider, Destroyable, RtspMediaStreamOptions } from "../../rtsp/src/rtsp";
import { EventEmitter } from "stream";
import child_process, { ChildProcess } from 'child_process';
import { ffmpegLogInitialOutput } from '../../../common/src/media-helpers';
import net from 'net';
import { listenZeroCluster } from "../../../common/src/listen-cluster";

const { mediaManager } = sdk;

class AmcrestCamera extends RtspSmartCamera implements Camera, Intercom {
    eventStream: Stream;
    cp: ChildProcess;
    client: AmcrestCameraClient;
    maxExtraStreams: number;

    getClient() {
        if (!this.client)
            this.client = new AmcrestCameraClient(this.storage.getItem('ip'), this.getUsername(), this.getPassword(), this.console);
        return this.client;
    }

    listenEvents() {
        const ret = new EventEmitter() as (EventEmitter & Destroyable);
        ret.destroy = () => {
        };
        (async () => {
            try {
                const client = new AmcrestCameraClient(this.storage.getItem('ip'), this.getUsername(), this.getPassword(), this.console);
                const events = await client.listenEvents();
                ret.destroy = () => {
                    events.removeAllListeners();
                    events.destroy();
                };

                let pulseTimeout: NodeJS.Timeout;

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
                    else if (event === AmcrestEvent.TalkPulse) {
                        clearTimeout(pulseTimeout);
                        pulseTimeout = setTimeout(() => this.binaryState = false, 30000);
                        this.binaryState = true;
                    }
                })
            }
            catch (e) {
                ret.emit('error', e);
            }
        })();
        return ret;
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

    async getConstructedStreamUrl() {
        return `rtsp://${this.getRtspAddress()}/cam/realmonitor?channel=1&subtype=0`;
    }

    async takeSmartCameraPicture(option?: PictureOptions): Promise<MediaObject> {
        return mediaManager.createMediaObject(await this.getClient().jpegSnapshot(), 'image/jpeg');
    }

    async getConstructedVideoStreamOptions(): Promise<RtspMediaStreamOptions[]> {
        let mas = this.maxExtraStreams;
        if (!this.maxExtraStreams) {
            const client = this.getClient();
            try {
                const response = await client.digestAuth.request({
                    url: `http://${this.getHttpAddress()}/cgi-bin/magicBox.cgi?action=getProductDefinition&name=MaxExtraStream`,
                    responseType: 'text',
                })
                this.maxExtraStreams = parseInt(response.data.split('=')[1].trim());
                mas = this.maxExtraStreams;
            }
            catch (e) {
            }
        }
        mas = mas || 1;
        return [...Array(mas + 1).keys()].map(subtype => this.createRtspMediaStreamOptions(`rtsp://${this.getRtspAddress()}/cam/realmonitor?channel=1&subtype=${subtype}`, subtype));
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

            try {
                await this.getClient().digestAuth.request({
                    method: 'POST',
                    url,
                    headers: {
                        'Content-Type': 'Audio/AAC',
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
            '-acodec', 'libfdk_aac',
            '-f', 'adts',
            `tcp://127.0.0.1:${port}`,
        );

        this.console.log('ffmpeg intercom', args);

        const ffmpeg = await mediaManager.getFFmpegPath();
        this.cp = child_process.spawn(ffmpeg, args);
        this.cp.on('killed', () => this.cp = undefined);
        ffmpegLogInitialOutput(this.console, this.cp);
    }

    async stopIntercom(): Promise<void> {
        this.cp?.kill();
        this.cp = undefined;
    }

    showRtspUrlOverride() {
        return false;
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
