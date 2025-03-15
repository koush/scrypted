import { AudioStreamOptions } from "@scrypted/sdk";
import { RTCRtpCodecParameters } from "./werift";

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

export const optionalVideoCodec = new RTCRtpCodecParameters({
    mimeType: "video/H265",
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
        payloadType: 111,
    }),
    // new RTCRtpCodecParameters({
    //     mimeType: "audio/G722",
    //     clockRate: 8000,
    //     channels: 1,
    //     payloadType: 9,
    // }),
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
        payloadType: 8,
    }),
];

export const opusAudioCodecOnly = [
    new RTCRtpCodecParameters({
        mimeType: "audio/opus",
        clockRate: 48000,
        channels: 2,
        payloadType: 111,
    }),
];

export function getAudioCodec(outputCodecParameters: RTCRtpCodecParameters) {
    if (outputCodecParameters.name === 'PCMA') {
        return {
            name: 'pcm_alaw',
            encoder: 'pcm_alaw',
            sampleRate: 8000,
        };
    }
    if (outputCodecParameters.name === 'PCMU') {
        return {
            name: 'pcm_mulaw',
            encoder: 'pcm_mulaw',
            sampleRate: 8000,
        };
    }
    return {
        name: 'opus',
        encoder: 'libopus',
        sampleRate: 16000,
    };
}

export function getFFmpegRtpAudioOutputArguments(audio: AudioStreamOptions, outputCodecParameters: RTCRtpCodecParameters, maximumCompatibilityMode: boolean) {
    const ret: string[] = [];

    const { encoder, name, sampleRate } = getAudioCodec(outputCodecParameters);

    if (audio?.codec === name && (!audio?.sampleRate || audio?.sampleRate === sampleRate) && !maximumCompatibilityMode) {
        ret.push('-acodec', 'copy');
    }
    else {
        ret.push(
            '-acodec', encoder,
            '-flags', '+global_header',
            '-ar', `${outputCodecParameters.clockRate}`,
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
