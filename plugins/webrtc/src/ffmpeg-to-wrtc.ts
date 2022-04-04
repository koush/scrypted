import { MediaStreamTrack, RTCPeerConnection, RTCRtpCodecParameters } from "@koush/werift";
import { closeQuiet, createBindZero, listenZeroSingleClient } from "@scrypted/common/src/listen-cluster";
import { safeKillFFmpeg } from "@scrypted/common/src/media-helpers";
import { connectRTCSignalingClients } from "@scrypted/common/src/rtc-signaling";
import { RtspServer } from "@scrypted/common/src/rtsp-server";
import { createSdpInput } from "@scrypted/common/src/sdp-utils";
import { StorageSettings } from "@scrypted/common/src/settings";
import sdk, { FFMpegInput, Intercom, RTCAVSignalingSetup, RTCSignalingOptions, RTCSignalingSession } from "@scrypted/sdk";
import { ChildProcess } from "child_process";
import ip from 'ip';
import { WebRTCOutputSignalingSession } from "./output-signaling-session";
import { getFFmpegRtpAudioOutputArguments, startRtpForwarderProcess } from "./rtp-forwarders";
import { ScryptedSessionControl } from "./session-control";
import { WebRTCStorageSettingsKeys } from "./webrtc-storage-settings";
import { isPeerConnectionAlive } from "./werift-util";

const { mediaManager, systemManager, deviceManager } = sdk;

function createSetup(type: 'offer' | 'answer', audioDirection: RTCRtpTransceiverDirection, videoDirection: RTCRtpTransceiverDirection): RTCAVSignalingSetup {
    return {
        type,
        audio: {
            direction: audioDirection,
        },
        video: {
            direction: videoDirection,
        },
    }
};

export async function createRTCPeerConnectionSink(
    session: RTCSignalingSession,
    storageSettings: StorageSettings<WebRTCStorageSettingsKeys>,
    ffInput: FFMpegInput,
    console: Console,
    intercom: Intercom,
    options: RTCSignalingOptions) {
    const hasIntercom = !!intercom;

    const answerAudioDirection = hasIntercom
        ? 'sendrecv'
        : 'sendonly';

    const { mediaStreamOptions } = ffInput;

    const codec = new RTCRtpCodecParameters({
        mimeType: "video/H264",
        clockRate: 90000,
    });

    const pc = new RTCPeerConnection({
        codecs: {
            video: [
                codec,
            ],
            audio: [
                new RTCRtpCodecParameters({
                    mimeType: "audio/opus",
                    clockRate: 48000,
                    channels: 1,
                })
            ],
        }
    });

    const vtrack = new MediaStreamTrack({
        kind: "video", codec,
    });
    const videoTransceiver = pc.addTransceiver(vtrack, {
        direction: 'sendonly',
    });

    const atrack = new MediaStreamTrack({ kind: "audio" });
    const audioTransceiver = pc.addTransceiver(atrack, {
        direction: answerAudioDirection,
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
            "a=rtpmap:110 opus/48000/1",
            "a=fmtp:101 minptime=10;useinbandfec=1",
        ];
        let sdp = sdpReturnAudio.join('\r\n');
        sdp = createSdpInput(audioOutput.port, 0, sdp);

        audioTransceiver.onTrack.subscribe(async (track) => {
            const url = rtspTcpServer.url.replace('tcp:', 'rtsp:');
            const ffmpegInput: FFMpegInput = {
                url,
                inputArguments: [
                    '-rtsp_transport', 'udp',
                    '-i', url,
                ],
            };
            const mo = await mediaManager.createFFmpegMediaObject(ffmpegInput);
            intercom.startIntercom(mo);

            const client = await rtspTcpServer.clientPromise;

            const rtspServer = new RtspServer(client, sdp, audioOutput.server);
            // rtspServer.console = console;
            await rtspServer.handlePlayback();
            track.onReceiveRtp.subscribe(rtpPacket => {
                rtpPacket.header.payloadType = 110;
                rtspServer.sendAudio(rtpPacket.serialize(), false);
            })
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
            }

            console.log('Connection is local network:', isPrivate);

            // should really inspect the session description here.

            // we assume that the camera doesn't output h264 baseline, because
            // that is awful quality. so check to see if the session has an
            // explicit list of supported codecs with h264 high on it.
            const sessionSupportsH264High = options?.capabilities?.video?.codecs
                ?.filter(codec => codec.mimeType.toLowerCase() === 'video/h264')
                // 42 is baseline profile
                // 64 is high profile
                // not sure what main profile is, dunno if anything actually uses it.
                ?.find(codec => codec.sdpFmtpLine.includes('profile-level-id=64'))

            const videoArgs: string[] = [];
            const transcode = !sessionSupportsH264High
                || mediaStreamOptions?.video?.codec !== 'h264'
                || storageSettings.values.transcode === 'Always';
            if (transcode) {
                const encoderArguments: string = storageSettings.values.encoderArguments;
                if (!encoderArguments) {
                    videoArgs.push(
                        '-vcodec', 'libx264',
                        '-preset', 'ultrafast',
                        // this causes chromecast to chop and show frames only every 10 seconds.
                        // but it seems to work fine everywhere else?
                        // '-tune', 'zerolatency',
                    );
                }
                else {
                    videoArgs.push(...encoderArguments.split(' '))
                }

                videoArgs.push(
                    "-bf", "0",
                    '-r', '15',
                    '-vf', 'scale=w=iw/2:h=ih/2',
                    '-profile:v', 'baseline',
                    // this seems to cause issues with presets i think.
                    // '-level:v', '4.0',
                    '-b:v', storageSettings.values.bitrate.toString(),
                    '-maxrate', storageSettings.values.bitrate.toString(),
                    '-bufsize', storageSettings.values.bitrate.toString(),
                )
            }
            else {
                videoArgs.push('-vcodec', 'copy')
            }

            if (storageSettings.values.addExtraData)
                videoArgs.push("-bsf:v", "dump_extra");

            const decoderArguments: string[] = storageSettings.values.decoderArguments?.split(' ') || [];

            const { cp } = await startRtpForwarderProcess(console, [
                ...(transcode ? decoderArguments : []),

                ...ffInput.inputArguments,
            ], {
                video: {
                    transceiver: videoTransceiver,
                    outputArguments: [
                        '-an',
                        ...videoArgs,
                        '-pkt_size', '1300',
                        '-fflags', '+flush_packets', '-flush_packets', '1',
                    ]
                },
                audio: {
                    transceiver: audioTransceiver,
                    outputArguments: [
                        ...getFFmpegRtpAudioOutputArguments(),
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

    const answerSession = new WebRTCOutputSignalingSession(pc);

    const offerAudioDirection = hasIntercom
        ? 'sendrecv'
        : 'recvonly';

    connectRTCSignalingClients(console, session, createSetup('offer', offerAudioDirection, 'recvonly'),
        answerSession, createSetup('answer', answerAudioDirection, 'sendonly'), !!options?.offer);

    return new ScryptedSessionControl(cleanup);
}
