import { getH264DecoderArgs, getH264EncoderArgs } from "@scrypted/common/src/ffmpeg-hardware-acceleration";
import { StorageSettings } from "@scrypted/common/src/settings";
import { MixinDeviceBase, ScryptedDeviceBase } from "@scrypted/sdk";

export type WebRTCStorageSettingsKeys = "useSdp" | "addExtraData" | "transcode" | "decoderArguments" | "encoderArguments" | "bitrate";

export function createWebRTCStorageSettings(device: MixinDeviceBase<any> | ScryptedDeviceBase): StorageSettings<WebRTCStorageSettingsKeys> {
    return new StorageSettings(device, {
        useSdp: {
            title: 'Use SDP/UDP instead of RTSP',
            description: 'Experimental',
            type: 'boolean',
            defaultValue: true,
            hide: true,
        },
        addExtraData: {
            title: 'Add H264 Extra Data',
            description: 'Some cameras do not include H264 extra data in the stream and this causes live streaming to always fail (but recordings may be working). This is a inexpensive video filter and does not perform a transcode. Enable this setting only as necessary.',
            type: 'boolean',
        },
        transcode: {
            title: 'Transcode Streaming',
            defaultValue: 'Default',
            choices: [
                'Default',
                'Always',
                'Never',
            ],
        },
        decoderArguments: {
            title: 'Video Decoder Arguments',
            placeholder: '-hwaccel auto',
            description: 'FFmpeg arguments used to decode input video.',
            combobox: true,
            choices: Object.keys(getH264DecoderArgs()),
            mapPut(oldValue, newValue) {
                return getH264DecoderArgs()[newValue]?.join(' ') || newValue;
            },
        },
        encoderArguments: {
            title: 'H264 Encoder Arguments',
            description: 'FFmpeg arguments used to encode h264 video.',
            combobox: true,
            choices: Object.keys(getH264EncoderArgs()),
            mapPut(oldValue, newValue) {
                return getH264EncoderArgs()[newValue]?.join(' ') || newValue;
            }
        },
        bitrate: {
            title: 'Bitrate',
            description: 'The bitrate to send when transcoding video.',
            type: 'number',
            defaultValue: 500000,
        },
    });
}