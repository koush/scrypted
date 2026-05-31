import { MediaStreamDestination, ScryptedDevice, ScryptedInterface, VideoCamera } from "@scrypted/sdk";
import { H264Level, H264Profile, StartStreamRequest } from '../../hap';
import sdk from '@scrypted/sdk';
import { HomeKitPlugin } from "../../main";

const { log } = sdk;

// opus is now the default and aac-eld is no longer usable without this flag being set at compile time.
export const FORCE_OPUS = true;

export function profileToFfmpeg(profile: H264Profile): string {
    if (profile === H264Profile.HIGH)
        return "high";
    if (profile === H264Profile.MAIN)
        return "main";
    return "baseline";
}

export function levelToFfmpeg(level: H264Level): string {
    if (level === H264Level.LEVEL4_0)
        return '4.0';
    if (level === H264Level.LEVEL3_2)
        return '3.2';
    return '3.1';
}

// from werift
export function bufferWriter(bytes: number[], values: (number | bigint)[]) {
    const length = bytes.reduce((acc, cur) => acc + cur, 0);
    const buf = Buffer.alloc(length);
    let offset = 0;

    values.forEach((v, i) => {
        const size = bytes[i];
        if (size === 8) buf.writeBigUInt64BE(v as bigint, offset);
        else buf.writeUIntBE(v as number, offset, size);

        offset += size;
    });
    return buf;
}

// from werift
export const ntpTime = () => {
    const now = performance.timeOrigin + performance.now() - Date.UTC(1900, 0, 1);

    const seconds = now / 1000;
    const [sec, msec] = seconds.toString().split(".").map(Number);

    const buf = bufferWriter([4, 4], [sec, msec]);

    return buf.readBigUInt64BE();
};

export async function getStreamingConfiguration(device: ScryptedDevice & VideoCamera, isHomeHub: boolean, storage: Storage, request: StartStreamRequest) {
    // Observed packet times:
    // Opus (Local): 20
    // Opus (Remote): 60
    // AAC-ELD (Local): 30
    // AAC-ELD (Remote): 60
    const isLowBandwidth = request.audio.packet_time >= 60;

    // Apple Watch Series 1 to 3
    // 38mm: 320 x 360 pixels
    // 42mm: 378 x 448 pixels
    // Apple Watch Series 4 to 6
    // 40mm: 360 x 448 pixels
    // 44mm: 408 x 496 pixels
    // Apple Watch Series 7 and 8
    // 41mm: 396 x 484 pixels
    // 45mm: 428 x 528 pixels
    // Apple Watch SE
    // 40mm: 360 x 448 pixels
    // 44mm: 408 x 496 pixels
    // Apple Watch Ultra
    // 49mm: 484 x 568 pixels
    // future proof-ish for higher resolution watch.
    const isWatch = request.video.width < 640;

    const destination: MediaStreamDestination = isWatch
        ? 'low-resolution'
        : isLowBandwidth
            ? 'remote'
            : isHomeHub
                ? 'medium-resolution'
                : 'local';

    // watch will/should also be a low bandwidth device.
    if (isWatch) {
        return {
            destination,
            isWatch,
            isLowBandwidth,
        };
    }

    if (isLowBandwidth) {
        return {
            destination,
            isWatch,
            isLowBandwidth,
        }
    }

    return {
        destination,
        isWatch,
        isLowBandwidth,
    }
}

export function transcodingDebugModeWarning() {
    console.warn('=================================================================================');
    console.warn('Transcoding Debug Mode is enabled on this camera.');
    console.warn('This setting is used to diagnose camera issues, and should not be used long term.');
    console.warn('The HomeKit Readme contains proper camera configuration to avoid transcoding.');
    console.warn('More robust transcoding options are available within the Rebroadcast Plugin.');
    console.warn('=================================================================================');
}

export function checkCompatibleCodec(console: Console, device: ScryptedDevice, videoCodec: String) {
    if (!videoCodec) {
        console.warn('=============================================================================');
        console.warn('No video codec reported. This stream may fail. Enable the Rebroadcast Plugin.');
        console.warn('Stream compatibility can be diagnosed by enabling Transcoding Debug Mode.');
        console.warn('=============================================================================');
        return;
    }
    const isDefinitelyNotH264 = videoCodec && videoCodec.toLowerCase().indexOf('h264') === -1;
    if (isDefinitelyNotH264) {
        const str =
            console.error('=============================================================================');
        console.error(`${device.name} video codec must be h264 but is ${videoCodec}.`);
        console.error('This stream may fail. Read the instructions in the HomeKit Plugin');
        console.error('to properly configure your camera codec.');
        console.error('Stream compatibility can be diagnosed by enabling Transcoding Debug Mode.');
        console.error('=============================================================================');

        log.a(`${device.name} video codec must be h264 but is ${videoCodec}. This stream may fail. Read the instructions in the HomeKit Plugin to properly configure your camera codec.`);
    }
}
