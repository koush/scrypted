import { MediaStreamTrack, RTCPeerConnection } from "@koush/werift";
import { getDebugModeH264EncoderArgs } from "@scrypted/common/src/ffmpeg-hardware-acceleration";
import { closeQuiet, createBindZero, listenZeroSingleClient } from "@scrypted/common/src/listen-cluster";
import { safeKillFFmpeg } from "@scrypted/common/src/media-helpers";
import { connectRTCSignalingClients } from "@scrypted/common/src/rtc-connect";
import { RtspServer } from "@scrypted/common/src/rtsp-server";
import { createSdpInput, parseSdp } from "@scrypted/common/src/sdp-utils";
import { StorageSettings } from "@scrypted/common/src/settings";
import sdk, { FFmpegInput, Intercom, MediaStreamDestination, RTCAVSignalingSetup, RTCSignalingSession } from "@scrypted/sdk";
import { ChildProcess } from "child_process";
import ip from 'ip';
import { WeriftOutputSignalingSession } from "./output-signaling-session";
import { getFFmpegRtpAudioOutputArguments, startRtpForwarderProcess } from "./rtp-forwarders";
import { ScryptedSessionControl } from "./session-control";
import { requiredAudioCodec, requiredVideoCodec } from "./webrtc-required-codecs";
import { WebRTCStorageSettingsKeys } from "./webrtc-storage-settings";
import { isPeerConnectionAlive } from "./werift-util";

const { mediaManager } = sdk;

const iceServer = {
    urls: ["turn:turn.scrypted.app:3478"],
    username: "foo",
    credential: "bar",
};
const iceServers = [
    iceServer,
];

function createSetup(audioDirection: RTCRtpTransceiverDirection, videoDirection: RTCRtpTransceiverDirection): Partial<RTCAVSignalingSetup> {
    return {
        configuration: {
            iceServers,
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
    storageSettings: StorageSettings<WebRTCStorageSettingsKeys>,
    console: Console,
    intercom: Intercom,
    getFFmpegInput: (destination: MediaStreamDestination) => Promise<FFmpegInput>,
    ) {

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
                requiredAudioCodec,
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

    const audioOutput = await createBindZero();
    const rtspTcpServer = hasIntercom ? await listenZeroSingleClient() : undefined;

    if (hasIntercom) {
        const sdpReturnAudio = [
            "v=0",
            "o=- 0 0 IN IP4 127.0.0.1",
            "s=" + "WebRTC Audio Talkback",
            "c=IN IP4 127.0.0.1",
            "t=0 0",
            "m=audio 0 RTP/AVP 110",
            "b=AS:24",
            "a=rtpmap:110 opus/48000/2",
            "a=fmtp:101 minptime=10;useinbandfec=1",
        ];
        let sdp = sdpReturnAudio.join('\r\n');
        sdp = createSdpInput(audioOutput.port, 0, sdp);

        audioTransceiver.onTrack.subscribe(async (track) => {
            try {
                const url = rtspTcpServer.url.replace('tcp:', 'rtsp:');
                const ffmpegInput: FFmpegInput = {
                    url,
                    inputArguments: [
                        '-rtsp_transport', 'udp',
                        '-i', url,
                    ],
                };
                const mo = await mediaManager.createFFmpegMediaObject(ffmpegInput);
                await intercom.startIntercom(mo);

                const client = await rtspTcpServer.clientPromise;

                const rtspServer = new RtspServer(client, sdp, audioOutput.server);
                // rtspServer.console = console;
                await rtspServer.handlePlayback();
                const parsedSdp = parseSdp(rtspServer.sdp);
                const audioTrack = parsedSdp.msections.find(msection => msection.type === 'audio').control;


                track.onReceiveRtp.subscribe(rtpPacket => {
                    rtpPacket.header.payloadType = 110;
                    rtspServer.sendTrack(audioTrack, rtpPacket.serialize(), false);
                })
            }
            catch (e) {
                console.log('webrtc talkback failed', e);
            }
        })
    }

    const cpPromise: Promise<ChildProcess> = new Promise(resolve => {
        let connected = false;
        pc.connectionStateChange.subscribe(async () => {
            if (connected)
                return;

            if (pc.connectionState !== 'connected')
                return;

            connected = true;

            let isPrivate = true;
            for (const ice of pc.validIceTransports()) {
                const [address, port] = ice.connection.remoteAddr;
                isPrivate = isPrivate && ip.isPrivate(address);
                console.log('ice transport ip', address);
            }

            console.log('Connection is local network:', isPrivate);

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

            const ffmpegInput = await getFFmpegInput(isPrivate ? 'local' : 'remote');
            const { mediaStreamOptions } = ffmpegInput;

            const videoArgs: string[] = [];
            const transcode = !sessionSupportsH264High
                || mediaStreamOptions?.video?.codec !== 'h264'
                || ffmpegInput.h264EncoderArguments?.length;
            if (transcode) {
                const bitrate = ffmpegInput.destinationVideoBitrate || 750000;
                videoArgs.push(
                    // this might get wonky with 4:3?
                    '-vf', "scale='min(1280,iw)':-2",
                    // this seems to cause issues with presets i think.
                    // '-level:v', '4.0',
                    "-b:v", bitrate.toString(),
                    "-bufsize", (2 * bitrate).toString(),
                    "-maxrate", bitrate.toString(),
                    '-r', '15',
                )
                if (!sessionSupportsH264High) {
                    // baseline profile must use libx264, not sure other encoders properly support it.
                    videoArgs.push(
                        '-profile:v', 'baseline',
                        ...getDebugModeH264EncoderArgs(),
                        // this causes chromecast to chop and show frames only every 10 seconds.
                        // but it seems to work fine everywhere else?
                        // '-tune', 'zerolatency',
                    );
                }
                else {
                    videoArgs.push(...(ffmpegInput.h264EncoderArguments || getDebugModeH264EncoderArgs()));
                }
            }
            else {
                videoArgs.push('-vcodec', 'copy')
            }

            if (ffmpegInput.h264FilterArguments)
                videoArgs.push(...ffmpegInput.h264FilterArguments);

            const { cp } = await startRtpForwarderProcess(console, [
                ...(transcode ? ffmpegInput.videoDecoderArguments || [] : []),

                ...ffmpegInput.inputArguments,
            ], {
                video: {
                    transceiver: videoTransceiver,
                    outputArguments: [
                        '-an', '-sn', '-dn',
                        ...videoArgs,
                        '-pkt_size', '1300',
                        '-fflags', '+flush_packets', '-flush_packets', '1',
                    ]
                },
                audio: {
                    transceiver: audioTransceiver,
                    outputArguments: [
                        ...getFFmpegRtpAudioOutputArguments(ffmpegInput.mediaStreamOptions?.audio?.codec),
                    ]
                }
            })

            cp.on('exit', cleanup);
            resolve(cp);
        });
    });

    const cleanup = async () => {
        // no need to explicitly stop intercom as the server closing will terminate it.
        // do this to prevent shared intercom clobbering.
        closeQuiet(audioOutput.server);
        closeQuiet(rtspTcpServer?.server);
        await Promise.allSettled([
            rtspTcpServer?.clientPromise.then(client => client.destroy()),
            pc?.close(),
            cpPromise?.then(cp => safeKillFFmpeg(cp)),
        ])
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

    const cameraSignalingSession = new WeriftOutputSignalingSession(pc);

    const clientAudioDirection = hasIntercom
        ? 'sendrecv'
        : 'recvonly';

    connectRTCSignalingClients(console,
        clientSignalingSession, createSetup(clientAudioDirection, 'recvonly'),
        cameraSignalingSession, createSetup(cameraAudioDirection, 'sendonly'));

    return new ScryptedSessionControl(cleanup);
}
