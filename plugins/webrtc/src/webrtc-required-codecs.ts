import { RTCRtpCodecParameters } from "@koush/werift";
import sdk, {  } from "@scrypted/sdk";

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

export const requiredAudioCodec = new RTCRtpCodecParameters({
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
});
