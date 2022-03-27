import { MediaStreamOptions, ScryptedDevice, ScryptedInterface, VideoCamera } from "@scrypted/sdk";
import { StartStreamRequest, H264Level, H264Profile } from '../../hap';

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

export async function getStreamingConfiguration(device: ScryptedDevice & VideoCamera, storage: Storage, request: StartStreamRequest) {
    // Have only ever seen 20 and 60 sent here. 60 is remote stream and watch.
    const isLowBandwidth = request.audio.packet_time > 20;

    // watch is 448x368 and requests 320x240, everything else is > ~1280...
    // future proof-ish for higher resolution watch.
    const isWatch = request.video.width <= 640;

    const streamingChannel = isWatch
        ? storage.getItem('streamingChannelWatch')
        : isLowBandwidth
            ? storage.getItem('streamingChannelHub')
            : storage.getItem('streamingChannel');
    let selectedStream: MediaStreamOptions;
    const msos = await device.getVideoStreamOptions();
    if (streamingChannel)
        selectedStream = msos?.find(mso => mso.name === streamingChannel);
    if (!selectedStream)
        selectedStream = msos?.[0];

    selectedStream = selectedStream || {
        id: undefined,
    };

    const canDynamicBitrate = device.interfaces.includes(ScryptedInterface.VideoCameraConfiguration);

    // watch will/should also be a low bandwidth device.
    if (isWatch) {
        const watchStreamingMode = storage.getItem('watchStreamingMode');
        return {
            dynamicBitrate: canDynamicBitrate && watchStreamingMode === 'Adaptive Bitrate',
            transcodeStreaming: watchStreamingMode === 'Transcode',
            selectedStream,
            isWatch,
            isLowBandwidth,
        };
    }

    if (isLowBandwidth) {
        let hubStreamingMode = storage.getItem('hubStreamingMode');

        // 3/19/2022 migrate setting.
        if (storage.getItem('transcodeStreamingHub') === 'true') {
            if (!hubStreamingMode)
                hubStreamingMode = 'Transcode';
            storage.removeItem('transcodeStreamingHub');
        }

        return {
            dynamicBitrate: canDynamicBitrate && hubStreamingMode === 'Adaptive Bitrate',
            transcodeStreaming: hubStreamingMode === 'Transcode',
            selectedStream,
            isWatch,
            isLowBandwidth,
        }
    }

    let transcodeStreaming = storage.getItem('transcodeStreaming');

    return {
        dynamicBitrate: false,
        transcodeStreaming: transcodeStreaming === 'true',
        selectedStream,
        isWatch,
        isLowBandwidth,
    }
}
