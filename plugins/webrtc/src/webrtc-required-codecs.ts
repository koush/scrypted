import { RTCRtpCodecParameters } from "@koush/werift";
import sdk from "@scrypted/sdk";

const { mediaManager } = sdk;
export const requiredVideoCodec = new RTCRtpCodecParameters({
    mimeType: "video/H264",
    clockRate: 90000,
    rtcpFeedback: [
        { type: "transport-cc" },
        { type: "ccm", parameter: "fir" },
        { type: "nack" },
        { type: "nack", parameter: "pli" },
        { type: "goog-remb" },
    ],
    parameters: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f'
});

export const requiredAudioCodecs = [
    new RTCRtpCodecParameters({
        mimeType: "audio/opus",
        clockRate: 48000,
        channels: 2,
    }),
    new RTCRtpCodecParameters({
        mimeType: "audio/PCMU",
        clockRate: 8000,
        channels: 1,
        payloadType: 0,
    }),
    new RTCRtpCodecParameters({
        mimeType: "audio/PCMA",
        clockRate: 8000,
        channels: 1,
    }),
];


export function getAudioCodec(outputCodecParameters: RTCRtpCodecParameters) {
    if (outputCodecParameters.name === 'PCMA') {
        return {
            name: 'pcm_alaw',
            encoder: 'pcm_alaw',
        };
    }
    if (outputCodecParameters.name === 'PCMU') {
        return {
            name: 'pcm_ulaw',
            encoder: 'pcm_ulaw',
        };
    }
    return {
        name: 'opus',
        encoder: 'libopus',
    };
}

export function getFFmpegRtpAudioOutputArguments(inputCodec: string, outputCodecParameters: RTCRtpCodecParameters, maximumCompatibilityMode: boolean) {
    const ret: string[] = [];

    const { encoder, name } = getAudioCodec(outputCodecParameters);

    if (inputCodec === name && !maximumCompatibilityMode) {
        ret.push('-acodec', 'copy');
    }
    else {
        ret.push(
            '-acodec', encoder,
            '-flags', '+global_header',
            '-ar', '48k',
            // choose a better birate? this is on the high end recommendation for voice.
            '-b:a', '40k',
            '-bufsize', '96k',
            '-ac', outputCodecParameters.channels.toString(),
        )

        if (encoder === 'libopus')
            ret.push(
                '-application', 'lowdelay',
                // webrtc is supposed to support various frame durations but
                // in practice it expects the default 20 in various implementations.
                // '-frame_duration', '60',
            );
    }
    return ret;
}
