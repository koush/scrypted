import sdk, { AudioSensor, FFmpegInput, MixinProvider, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, SettingValue, VideoCamera, WritableDeviceState } from "@scrypted/sdk";
import { SettingsMixinDeviceBase, SettingsMixinDeviceOptions } from "@scrypted/sdk/settings-mixin";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import { startRtpForwarderProcess } from '../../webrtc/src/rtp-forwarders';
import { RtpPacket } from "../../../external/werift/packages/rtp/src/rtp/rtp";
import { sleep } from "@scrypted/common/src/sleep";

function pcmU8ToDb(payload: Uint8Array): number {
    let sum = 0;
    const count = payload.length;

    if (count === 0) return 0; // Treat empty input as silence (0 dB)

    for (let i = 0; i < count; i++) {
        const sample = payload[i] - 128; // Convert to signed range (-128 to 127)
        sum += sample * sample;
    }

    const rms = Math.sqrt(sum / count);
    const minRMS = 1.0; // Define a minimum reference level to avoid log(0)

    if (rms < minRMS) return 0; // Silence is 0 dB

    const db = 20 * Math.log10(rms / minRMS); // Scale against the minimum audible level
    return db;
}

class FFmpegAudioDetectionMixin extends SettingsMixinDeviceBase<AudioSensor> implements AudioSensor {
    storageSettings = new StorageSettings(this, {
        decibelThreshold: {
            title: 'Decibel Threshold',
            type: 'number',
            description: 'The decibel level at which to trigger an event.',
            defaultValue: 20,
        },
        audioTimeout: {
            title: 'Audio Timeout',
            type: 'number',
            description: 'The number of seconds to wait after the last audio event before resetting the audio sensor.',
            defaultValue: 10,
        },
    });
    ensureInterval: NodeJS.Timeout;
    forwarder: ReturnType<typeof startRtpForwarderProcess>;
    audioResetInterval: NodeJS.Timeout;

    constructor(options: SettingsMixinDeviceOptions<AudioSensor>) {
        super(options);
        this.ensureInterval = setInterval(() => this.ensureAudioSensor(), 60000);
        this.ensureAudioSensor();
    };

    ensureAudioSensor() {
        if (!this.ensureInterval)
            return;

        if (this.forwarder)
            return;

        this.audioDetected = false;
        clearInterval(this.audioResetInterval);
        this.audioResetInterval = undefined;

        const fp = this.ensureAudioSensorInternal();
        this.forwarder = fp;

        fp.catch(() => {
            if (this.forwarder === fp)
                this.forwarder = undefined;
        });

        this.forwarder.then(f => {
            f.killPromise.then(() => {
                if (this.forwarder === fp)
                    this.forwarder = undefined;
            });
        })
    }

    async ensureAudioSensorInternal() {
        await sleep(5000);
        if (!this.forwarder)
            throw new Error('released/killed');
        const realDevice = sdk.systemManager.getDeviceById<VideoCamera>(this.id);
        const mo = await realDevice.getVideoStream({
            video: null,
            audio: {},
        });
        const ffmpegInput = await sdk.mediaManager.convertMediaObjectToJSON<FFmpegInput>(mo, ScryptedMimeTypes.FFmpegInput);

        let lastAudio = 0;

        const forwarder = await startRtpForwarderProcess(this.console, ffmpegInput, {
            video: null,
            audio: {
                codecCopy: 'pcm_u8',
                encoderArguments: [
                    '-acodec', 'pcm_u8',
                    '-ac', '1',
                    '-ar', '8000',
                ],
                onRtp: rtp => {
                    const now = Date.now();
                    // if this.audioDetected is true skip the processing unless the lastAudio time is halfway through the interval
                    if (this.audioDetected && now - lastAudio < this.storageSettings.values.audioTimeout * 500)
                        return;

                    const packet = RtpPacket.deSerialize(rtp);
                    const decibels = pcmU8ToDb(packet.payload);
                    if (decibels < this.storageSettings.values.decibelThreshold)
                        return;

                    this.audioDetected = true;
                    lastAudio = now;
                },
            }
        });

        this.audioResetInterval = setInterval(() => {
            if (!this.audioDetected)
                return;
            if (Date.now() - lastAudio < this.storageSettings.values.audioTimeout * 1000)
                return;
            this.audioDetected = false;
        }, this.storageSettings.values.audioTimeout * 1000);

        return forwarder;
    }

    async getMixinSettings() {
        return this.storageSettings.getSettings();
    }

    putMixinSetting(key: string, value: SettingValue) {
        return this.storageSettings.putSetting(key, value);
    }

    async release() {
        this.forwarder?.then(f => f.kill());
        this.forwarder = undefined;

        clearInterval(this.ensureInterval);
        this.ensureInterval = undefined;

        clearTimeout(this.audioResetInterval);
        this.audioResetInterval = undefined;
    }
}

export class FFmpegAudioDetectionMixinProvider extends ScryptedDeviceBase implements MixinProvider {
    async canMixin(type: ScryptedDeviceType, interfaces: string[]) {
        if (type !== ScryptedDeviceType.Camera && type !== ScryptedDeviceType.Doorbell)
            return;
        if (!interfaces.includes(ScryptedInterface.VideoCamera))
            return;
        return [ScryptedInterface.AudioSensor, ScryptedInterface.Settings];
    }

    async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: WritableDeviceState): Promise<any> {
        return new FFmpegAudioDetectionMixin({
            group: 'Audio Detection',
            groupKey: 'audio-detection',
            mixinDevice,
            mixinDeviceInterfaces,
            mixinDeviceState,
            mixinProviderNativeId: this.nativeId,
        });
    }

    async releaseMixin(id: string, mixinDevice: any) {
        await (mixinDevice as FFmpegAudioDetectionMixin)?.release();
    }
}
