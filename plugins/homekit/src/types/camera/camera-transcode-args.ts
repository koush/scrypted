import sdk from '@scrypted/sdk';
import { getDebugModeH264EncoderArgs } from '@scrypted/common/src/ffmpeg-hardware-acceleration';

// Encoder/decoder choices for the HomeKit transcode paths (live streaming and
// HomeKit Secure Video). Software stays the default, so behavior is unchanged
// unless a hardware option is selected in the HomeKit plugin settings.

export const TRANSCODE_ENCODER_SOFTWARE = 'Software (libx264)';
export const TRANSCODE_DECODER_SOFTWARE = 'Software';

const ENCODERS: { [name: string]: () => string[] } = {
    [TRANSCODE_ENCODER_SOFTWARE]: () => getDebugModeH264EncoderArgs(),
    'NVIDIA (h264_nvenc)': () => ['-c:v', 'h264_nvenc', '-preset', 'p4', '-tune', 'll', '-bf', '0', '-pix_fmt', 'yuv420p'],
    'Intel QuickSync (h264_qsv)': () => ['-c:v', 'h264_qsv', '-preset', 'veryfast', '-bf', '0', '-pix_fmt', 'nv12'],
    'VideoToolbox (h264_videotoolbox)': () => ['-c:v', 'h264_videotoolbox', '-realtime', '1', '-bf', '0', '-pix_fmt', 'yuv420p'],
};

// Frames are downloaded to system memory after decode (no -hwaccel_output_format),
// so the existing CPU scale filter keeps working with every encoder.
const DECODERS: { [name: string]: string[] } = {
    [TRANSCODE_DECODER_SOFTWARE]: [],
    'NVIDIA CUDA': ['-hwaccel', 'cuda'],
    'Intel QuickSync': ['-hwaccel', 'qsv'],
    'VideoToolbox': ['-hwaccel', 'videotoolbox'],
};

export const TRANSCODE_ENCODER_CHOICES = Object.keys(ENCODERS);
export const TRANSCODE_DECODER_CHOICES = Object.keys(DECODERS);

function pluginSetting(key: string) {
    try {
        return sdk.deviceManager.getDeviceStorage()?.getItem(key) || undefined;
    }
    catch (e) {
        return undefined;
    }
}

export function getTranscodeEncoderArgs(): string[] {
    const choice = pluginSetting('transcodeEncoder');
    return (ENCODERS[choice] || ENCODERS[TRANSCODE_ENCODER_SOFTWARE])();
}

export function getTranscodeDecoderArgs(): string[] {
    const choice = pluginSetting('transcodeDecoder');
    return [...(DECODERS[choice] || [])];
}
