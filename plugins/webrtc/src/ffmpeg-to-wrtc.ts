import { MediaStreamTrack, RTCPeerConnection, RtpPacket } from "@koush/werift";
import { addH264VideoFilterArguments } from "@scrypted/common/src/ffmpeg-helpers";
import { connectRTCSignalingClients } from "@scrypted/common/src/rtc-signaling";
import { getSpsPps } from "@scrypted/common/src/sdp-utils";
import sdk, { FFmpegInput, FFmpegTranscodeStream, Intercom, MediaStreamDestination, RequestMediaStream, RTCAVSignalingSetup, RTCSignalingSession, ScryptedMimeTypes } from "@scrypted/sdk";
import { H264Repacketizer } from "../../homekit/src/types/camera/h264-packetizer";
import { turnServer } from "./ice-servers";
import { waitConnected } from "./peerconnection-util";
import { RtpTrack, RtpTracks, startRtpForwarderProcess } from "./rtp-forwarders";
import { ScryptedSessionControl } from "./session-control";
import { getAudioCodec, getFFmpegRtpAudioOutputArguments, requiredAudioCodecs, requiredVideoCodec } from "./webrtc-required-codecs";
import { WeriftSignalingSession } from "./werift-signaling-session";
import { isPeerConnectionAlive, logIsPrivateIceTransport } from "./werift-util";


function getDebugModeH264EncoderArgs() {
    return [
        '-profile:v', 'baseline',
        // ultrafast seems to have the lowest latency but forces constrained baseline
        // so the prior argument is redundant. It actualy seems like decoding non-baseline
        // on mac, at least, causes inherent latency which can't be flushed from upstream.
        '-preset','ultrafast',
        '-g', '60',
        "-c:v", "libx264",
        "-bf", "0",
        // "-tune", "zerolatency",
    ];
}

function createSetup(audioDirection: RTCRtpTransceiverDirection, videoDirection: RTCRtpTransceiverDirection): Partial<RTCAVSignalingSetup> {
    return {
        configuration: {
            iceServers: [
                turnServer,
            ],
        },
        audio: {
            direction: audioDirection,
        },
        video: {
            direction: videoDirection,
        },
    }
};

export async function createRTCPeerConnectionSink(
    clientSignalingSession: RTCSignalingSession,
    console: Console,
    intercom: Intercom,
    maximumCompatibilityMode: boolean,
    requestMediaStream: RequestMediaStream,
) {
    const timeStart = Date.now();

    const options = await clientSignalingSession.getOptions();
    const hasIntercom = !!intercom;

    const cameraAudioDirection = hasIntercom
        ? 'sendrecv'
        : 'sendonly';

    const videoCodecs = [
        requiredVideoCodec,
    ];

    /*
    if (mediaStreamOptions?.sdp) {
        // this path is here for illustrative purposes, and is unused
        // because this code always supplies an answer.
        // it could be useful in the offer case, potentially.
        // however, it seems that browsers ignore profile-level-id
        // that are not exactly what they are expecting for
        // baseline or high.
        // seems better to use the browser offer to determine the capability
        // set to see if a codec copy is possible.
        const fmtps = findFmtp(mediaStreamOptions.sdp, 'H264/90000');
        if (fmtps?.length === 1) {
            const fmtp = fmtps[0];

            const nativeVideoCodec = new RTCRtpCodecParameters({
                mimeType: "video/H264",
                clockRate: 90000,
                rtcpFeedback: [
                    { type: "transport-cc" },
                    { type: "ccm", parameter: "fir" },
                    { type: "nack" },
                    { type: "nack", parameter: "pli" },
                    { type: "goog-remb" },
                ],
                parameters: fmtp.fmtp,
            });

            videoCodecs.unshift(nativeVideoCodec);
        }
    }
    */

    const pc = new RTCPeerConnection({
        // werift supports ice servers, but it seems to fail for some reason.
        // it does not matter, as we can send the ice servers to the browser instead.
        // the cameras and alexa targets will also provide externally reachable addresses.
        codecs: {
            audio: [
                ...requiredAudioCodecs,
            ],
            video: videoCodecs,
        }
    });

    const vtrack = new MediaStreamTrack({
        kind: "video", codec: requiredVideoCodec,
    });
    const videoTransceiver = pc.addTransceiver(vtrack, {
        direction: 'sendonly',
    });

    const atrack = new MediaStreamTrack({ kind: "audio" });
    const audioTransceiver = pc.addTransceiver(atrack, {
        direction: cameraAudioDirection,
    });

    const forwarderPromise = (async () => {
        await waitConnected(pc);

        console.log('connected', Date.now() - timeStart);
        const isPrivate = logIsPrivateIceTransport(console, pc);

        // should really inspect the session description here.

        // we assume that the camera doesn't output h264 baseline, because
        // that is awful quality. so check to see if the session has an
        // explicit list of supported codecs with a passable h264 high on it.
        let sessionSupportsH264High = !!options?.capabilities?.video?.codecs
            ?.filter(codec => codec.mimeType.toLowerCase() === 'video/h264')
            // 42 is baseline profile
            // 64001f (chrome) or 640c1f (safari) is high profile.
            // firefox only advertises 42e01f.
            // nest hub max offers high 640015. this means the level (hex 15) is 2.1,
            // this corresponds to a resolution of 480p according to the spec?
            // https://en.wikipedia.org/wiki/Advanced_Video_Coding#Levels
            // however, the 640x1f indicates a max resolution of 720p, but
            // desktop browsers can handle 1080p+ fine regardless, since it does
            // not actually seem to confirm the level. the level is merely a hint
            // to make a rough guess as to the decoding capability of the client.
            ?.find(codec => {
                let sdpFmtpLine = codec.sdpFmtpLine.toLowerCase();
                return sdpFmtpLine.includes('profile-level-id=64001f')
                    || sdpFmtpLine.includes('profile-level-id=640c1f');
            });

        // firefox is misleading. special case that to disable transcoding.
        if (options?.userAgent?.includes('Firefox/'))
            sessionSupportsH264High = true;

        const transcodeBaseline = !sessionSupportsH264High || maximumCompatibilityMode;
        if (transcodeBaseline) {
            console.log('Requesting medium-resolution stream', {
                sessionSupportsH264High,
                maximumCompatibilityMode,
            });
        }
        const requestDestination: MediaStreamDestination = transcodeBaseline ? 'medium-resolution' : 'local';
        const mo = await requestMediaStream({
            video: {
                codec: 'h264',
            },
            audio: {
                codec: 'opus',
            },
            destination: isPrivate ? requestDestination : 'remote',
            tool: transcodeBaseline ? 'ffmpeg' : 'scrypted',
        });
        const ffmpegInput = await sdk.mediaManager.convertMediaObjectToJSON<FFmpegInput>(mo, ScryptedMimeTypes.FFmpegInput);
        const { mediaStreamOptions } = ffmpegInput;

        if (mediaStreamOptions.audio?.codec === 'pcm_ulaw') {
            audioTransceiver.sender.codec = audioTransceiver.codecs.find(codec => codec.mimeType === 'audio/PCMU')
        }
        else if (mediaStreamOptions.audio?.codec === 'pcm_alaw') {
            audioTransceiver.sender.codec = audioTransceiver.codecs.find(codec => codec.mimeType === 'audio/PCMA')
        }

        const { name: audioCodecName } = getAudioCodec(audioTransceiver.sender.codec);
        let audioCodecCopy = maximumCompatibilityMode ? undefined : audioCodecName;

        const videoTranscodeArguments: string[] = [];
        const transcode = transcodeBaseline
            || mediaStreamOptions?.video?.codec !== 'h264'
            || ffmpegInput.h264EncoderArguments?.length
            || ffmpegInput.h264FilterArguments?.length;

        let videoCodecCopy = transcode ? undefined : 'h264';

        if (ffmpegInput.mediaStreamOptions?.oobCodecParameters)
            videoTranscodeArguments.push("-bsf:v", "dump_extra");
        videoTranscodeArguments.push(...(ffmpegInput.h264FilterArguments || []));

        if (transcode) {
            const conservativeDefaultBitrate = 500000;
            const bitrate = maximumCompatibilityMode ? conservativeDefaultBitrate : (ffmpegInput.destinationVideoBitrate || conservativeDefaultBitrate);
            videoTranscodeArguments.push(
                // this seems to cause issues with presets i think.
                // '-level:v', '4.0',
                "-b:v", bitrate.toString(),
                "-bufsize", (2 * bitrate).toString(),
                "-maxrate", bitrate.toString(),
                '-r', '15',
            );

            const width = Math.max(640, Math.min(options?.screen?.width || 960, 1280));
            const scaleFilter = `scale='min(${width},iw)':-2`;
            addH264VideoFilterArguments(videoTranscodeArguments, scaleFilter);

            if (transcodeBaseline) {
                // baseline profile must use libx264, not sure other encoders properly support it.
                videoTranscodeArguments.push(

                    ...getDebugModeH264EncoderArgs(),
                );

                // unable to find conditions to make this working properly.
                // encoding results in chop if bitrate is not sufficient.
                // this may need to be aligned with h264 level?
                // or no bitrate hint?
                // videoArgs.push('-tune', 'zerolatency');
            }
            else {
                videoTranscodeArguments.push(...(ffmpegInput.h264EncoderArguments || getDebugModeH264EncoderArgs()));
            }
        }
        else {
            videoTranscodeArguments.push('-vcodec', 'copy')
        }

        const audioTranscodeArguments = getFFmpegRtpAudioOutputArguments(ffmpegInput.mediaStreamOptions?.audio?.codec, audioTransceiver.sender.codec, maximumCompatibilityMode);

        try {
            const transcodeStream: FFmpegTranscodeStream = await sdk.mediaManager.convertMediaObject(mo, ScryptedMimeTypes.FFmpegTranscodeStream);
            await transcodeStream({
                videoTranscodeArguments,
                audioTranscodeArguments,
            });
            videoTranscodeArguments.splice(0, videoTranscodeArguments.length);
            videoCodecCopy = 'copy';
            audioCodecCopy = 'copy';
        }
        catch (e) {
        }

        const audioRtpTrack: RtpTrack = {
            codecCopy: audioCodecCopy,
            onRtp: buffer => audioTransceiver.sender.sendRtp(buffer),
            encoderArguments: [
                ...audioTranscodeArguments,
            ]
        };

        const videoPacketSize = 1300;
        let h264Repacketizer: H264Repacketizer;
        let spsPps: ReturnType<typeof getSpsPps>;

        const videoRtpTrack: RtpTrack = {
            codecCopy: videoCodecCopy,
            packetSize: videoPacketSize,
            onMSection: (videoSection) => spsPps = getSpsPps(videoSection),
            onRtp: (buffer) => {
                if (!h264Repacketizer) {
                    h264Repacketizer = new H264Repacketizer(console, videoPacketSize, {
                        ...spsPps,
                    });
                }
                const repacketized = h264Repacketizer.repacketize(RtpPacket.deSerialize(buffer));
                for (const packet of repacketized) {
                    videoTransceiver.sender.sendRtp(packet);
                }
            },
            encoderArguments: [
                ...videoTranscodeArguments,
            ],
            firstPacket: () => console.log('first video packet', Date.now() - timeStart),
        };

        let tracks: RtpTracks;
        if (ffmpegInput.mediaStreamOptions?.audio === null) {
            tracks = {
                video: videoRtpTrack,
            }
        }
        else {
            tracks = {
                video: videoRtpTrack,
                audio: audioRtpTrack,
            }
        }

        const ret = await startRtpForwarderProcess(console, ffmpegInput, tracks);
        ret.killPromise.finally(cleanup);
        return ret;
    })();

    const cleanup = async () => {
        // no need to explicitly stop intercom as the server closing will terminate it.
        // do this to prevent shared intercom clobbering.
        await Promise.allSettled([
            pc?.close(),
            forwarderPromise?.then(f => f.kill()),
        ]);
    };

    pc.connectionStateChange.subscribe(() => {
        console.log('connectionStateChange', pc.connectionState);
        if (!isPeerConnectionAlive(pc))
            cleanup();
    });
    pc.iceConnectionStateChange.subscribe(() => {
        console.log('iceConnectionStateChange', pc.iceConnectionState);
        if (!isPeerConnectionAlive(pc))
            cleanup();
    });

    const cameraSignalingSession = new WeriftSignalingSession(console, pc);

    const clientAudioDirection = hasIntercom
        ? 'sendrecv'
        : 'recvonly';

    connectRTCSignalingClients(console,
        clientSignalingSession, createSetup(clientAudioDirection, 'recvonly'),
        cameraSignalingSession, createSetup(cameraAudioDirection, 'sendonly'));

    return new ScryptedSessionControl(cleanup, intercom, audioTransceiver);
}
