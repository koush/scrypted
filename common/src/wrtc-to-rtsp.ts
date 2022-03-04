import { RTCAVSignalingSetup, RTCSignalingChannel, FFMpegInput, MediaStreamOptions } from "@scrypted/sdk/types";
import { listenZeroSingleClient } from "./listen-cluster";
import { RTCPeerConnection, RtcpPayloadSpecificFeedback, RTCRtpCodecParameters } from "@koush/werift";
import dgram from 'dgram';
import { RtspServer } from "./rtsp-server";
import { Socket } from "net";
import { RTCSessionControl, RTCSignalingSession } from "@scrypted/sdk";
import { FullIntraRequest } from "@koush/werift/lib/rtp/src/rtcp/psfb/fullIntraRequest";
import { RpcPeer } from "../../server/src/rpc";

// this is an sdp corresponding to what is requested from webrtc.
// h264 baseline and opus are required codecs that all webrtc implementations must provide.
function createSdpInput(audioPort: number, videoPort: number, sdp: string) {
    let outputSdp = sdp
        .replace(/c=IN .*/, `c=IN IP4 127.0.0.1`)
        .replace(/m=audio \d+/, `m=audio ${audioPort}`)
        .replace(/m=video \d+/, `m=video ${videoPort}`);

    let lines = outputSdp.split('\n').map(line => line.trim());
    lines = lines
        .filter(line => !line.includes('a=rtcp-mux'))
        .filter(line => !line.includes('a=candidate'))
        .filter(line => !line.includes('a=ice'));

    const vindex = lines.findIndex(line => line.startsWith('m=video'));
    lines.splice(vindex + 1, 0, 'a=control:trackID=video');
    const aindex = lines.findIndex(line => line.startsWith('m=audio'));
    lines.splice(aindex + 1, 0, 'a=control:trackID=audio');
    outputSdp = lines.join('\r\n')

    outputSdp = outputSdp.split('m=')
        .slice(1)
        .map(line => 'm=' + line)
        .join('');
    return outputSdp;
}

export function getRTCMediaStreamOptions(id: string, name: string, useUdp: boolean): MediaStreamOptions {
    return {
        // set by consumer
        id,
        name,
        // not compatible with scrypted parser currently when it is udp
        tool: useUdp ? undefined : 'scrypted',
        container: 'rtsp',
        video: {
            codec: 'h264',
        },
        audio: {
            codec: 'opus',
        },
    };
}

export async function createRTCPeerConnectionSource(options: {
    console: Console,
    mediaStreamOptions: MediaStreamOptions,
    channel: RTCSignalingChannel,
    useUdp: boolean,
}): Promise<FFMpegInput> {
    const { mediaStreamOptions, channel, console, useUdp } = options;
    const videoPort = useUdp ? Math.round(Math.random() * 10000 + 30000) : 0;
    const audioPort = useUdp ? Math.round(Math.random() * 10000 + 30000) : 0;

    const { clientPromise, port } = await listenZeroSingleClient();

    let pictureLossInterval: NodeJS.Timeout;
    let pc: RTCPeerConnection;
    let socket: Socket;
    // rtsp server must operate in udp forwarding mode to accomodate packet reordering.
    let udp = dgram.createSocket('udp4');
    let sessionControl: RTCSessionControl;

    const cleanup = () => {
        console.log('webrtc/rtsp cleaning up');
        pc?.close();
        socket?.destroy();
        clearInterval(pictureLossInterval);
        try {
            udp.close();
        }
        catch (e) {
        }
        sessionControl?.endSession().catch(() => { });
    };

    clientPromise.then(async (client) => {
        socket = client;
        const rtspServer = new RtspServer(socket, undefined, udp);
        rtspServer.console = console;
        rtspServer.audioChannel = 0;
        rtspServer.videoChannel = 2;

        const pc = new RTCPeerConnection({
            codecs: {
                audio: [
                    new RTCRtpCodecParameters({
                        mimeType: "audio/opus",
                        clockRate: 48000,
                        channels: 2,
                    }),
                    // new RTCRtpCodecParameters({
                    //     mimeType: "audio/opus",
                    //     clockRate: 8000,
                    //     channels: 1,
                    // }),
                    // new RTCRtpCodecParameters({
                    //     mimeType: "audio/PCMU",
                    //     clockRate: 8000,
                    //     channels: 1,
                    // }),
                    // new RTCRtpCodecParameters({
                    //     mimeType: "audio/PCMA",
                    //     clockRate: 8000,
                    //     channels: 1,
                    // }),
                ],
                video: [
                    // h264 high
                    // new RTCRtpCodecParameters(
                    //     {
                    //         clockRate: 90000,
                    //         mimeType: "video/H264",
                    //         rtcpFeedback: [
                    //             { type: "transport-cc" },
                    //             { type: "ccm", parameter: "fir" },
                    //             { type: "nack" },
                    //             { type: "nack", parameter: "pli" },
                    //             { type: "goog-remb" },
                    //         ],
                    //         parameters: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=640c1f"
                    //     },
                    // ),
                    new RTCRtpCodecParameters({
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
                    })
                ],
            }
        });

        socket.on('close', cleanup);
        socket.on('error', cleanup);
        pc.iceConnectionStateChange.subscribe(() => {
            console.log('iceConnectionStateChange', pc.connectionState, pc.iceConnectionState);
            if (pc.iceConnectionState === 'disconnected'
                || pc.iceConnectionState === 'failed'
                || pc.iceConnectionState === 'closed') {
                cleanup();
            }
        });
        pc.connectionStateChange.subscribe(() => {
            console.log('connectionStateChange', pc.connectionState, pc.iceConnectionState);
            if (pc.connectionState === 'closed'
                || pc.connectionState === 'disconnected'
                || pc.connectionState === 'failed') {
                cleanup();
            }
        });

        const doSetup = async (setup: RTCAVSignalingSetup) => {
            let gotAudio = false;
            let gotVideo = false;

            const audioTransceiver = pc.addTransceiver("audio", setup.audio as any);
            audioTransceiver.onTrack.subscribe((track) => {
                // audioTransceiver.sender.replaceTrack(track);
                track.onReceiveRtp.subscribe((rtp) => {
                    if (!gotAudio) {
                        gotAudio = true;
                        console.log('received first audio packet');
                    }
                    rtspServer.sendAudio(rtp.serialize(), false);
                });
                // track.onReceiveRtcp.subscribe(rtcp => rtspServer.sendAudio(rtcp.serialize(), true));
            });

            const videoTransceiver = pc.addTransceiver("video", setup.video as any);
            videoTransceiver.onTrack.subscribe((track) => {
                track.onReceiveRtp.subscribe((rtp) => {
                    if (!gotVideo) {
                        gotVideo = true;
                        console.log('received first video packet');
                    }
                    rtspServer.sendVideo(rtp.serialize(), false);
                });
                // track.onReceiveRtcp.subscribe(rtcp => rtspServer.sendVideo(rtcp.serialize(), true));
                // what is this for? it was in the example code, but as far as i can tell, it doesn't
                // actually do anything?
                // track.onReceiveRtp.once(() => {
                //     pictureLossInterval = setInterval(() => videoTransceiver.receiver.sendRtcpPLI(track.ssrc!), 4000);
                // });

                track.onReceiveRtp.once(() => {
                    let firSequenceNumber = 0;
                    pictureLossInterval = setInterval(() => {
                        const fir = new FullIntraRequest({
                            senderSsrc: videoTransceiver.receiver.rtcpSsrc,
                            mediaSsrc: track.ssrc,
                            fir: [
                                {
                                    sequenceNumber: firSequenceNumber++,
                                    ssrc: track.ssrc,
                                }
                            ]
                        });
                        const packet = new RtcpPayloadSpecificFeedback({
                            feedback: fir,
                        });
                        videoTransceiver.receiver.dtlsTransport.sendRtcp([packet]);
                    }, 4000);
                });
            });
        }

        sessionControl = await channel.startRTCSignalingSession({
            [RpcPeer.PROPERTY_JSON_DISABLE_SERIALIZATION]: true,
            createLocalDescription: async (type, setup, sendIceCandidate) => {
                if (type === 'offer')
                    doSetup(setup);
                if (setup.datachannel)
                    pc.createDataChannel(setup.datachannel.label, setup.datachannel.dict);

                const gatheringPromise = pc.iceGatheringState === 'complete' ? Promise.resolve(undefined) : new Promise(resolve => pc.iceGatheringStateChange.subscribe(state => {
                    if (state === 'complete')
                        resolve(undefined);
                }));
                pc.onicecandidate = ev => {
                    sendIceCandidate?.(ev.candidate as any);
                };

                if (type === 'answer') {
                    let answer = await pc.createAnswer();
                    console.log(answer.sdp);
                    const set = pc.setLocalDescription(answer);
                    if (sendIceCandidate)
                        return answer as any;
                    await set;
                    await gatheringPromise;
                    answer = pc.localDescription || answer;
                    return {
                        sdp: answer.sdp,
                        type: answer.type,
                    };
                }
                else {
                    let offer = await pc.createOffer();
                    // console.log(offer.sdp);
                    const set = pc.setLocalDescription(offer);
                    if (sendIceCandidate)
                        return offer as any;
                    await set;
                    await gatheringPromise;
                    offer = await pc.createOffer();
                    return {
                        sdp: offer.sdp,
                        type: offer.type,
                    };
                }
            },
            setRemoteDescription: async (description: RTCSessionDescriptionInit, setup: RTCAVSignalingSetup) => {
                if (description.type === 'offer')
                    doSetup(setup);
                rtspServer.sdp = createSdpInput(audioPort, videoPort, description.sdp);
                console.log('rtsp sdp', rtspServer.sdp);

                if (useUdp) {
                    rtspServer.udpPorts = {
                        video: videoPort,
                        audio: audioPort,
                    };
                    rtspServer.client.write(rtspServer.sdp + '\r\n');
                    rtspServer.client.end();
                    rtspServer.client.on('data', () => { });
                    // rtspServer.client.destroy();
                    console.log('sdp sent');
                }
                else {
                    await rtspServer.handleSetup();
                }
                await pc.setRemoteDescription(description as any);
            },
            addIceCandidate: async (candidate: RTCIceCandidateInit) => {
                await pc.addIceCandidate(candidate as RTCIceCandidate);
            },
        } as RTCSignalingSession);
    })
        .catch(e => cleanup);


    if (useUdp) {
        const url = `tcp://127.0.0.1:${port}`;

        mediaStreamOptions.container = 'sdp';
        return {
            url,
            mediaStreamOptions,
            inputArguments: [
                '-protocol_whitelist', 'pipe,udp,rtp,file,crypto,tcp',
                '-acodec', 'libopus',
                "-f", "sdp",

                // hint to ffmpeg for how long to wait for out of order packets.
                // is only used by udp, i think? unsure. but it causes severe jitter
                // when there are late or missing packets.
                // the jitter buffer should be on the actual rendering side.

                // using this managed to bust parsing rebroadcast permanently.
                // unclear if it was recoverable, seems not.
                // not actually sure that was the cause, because it worked again
                // later. have not seen the issue since.

                // using this this also causes major issues with mp4 muxing, wherein
                // entire seconds are chopped.

                // "-max_delay", "0",

                '-i', url,
            ]
        };
    }
    else {
        const url = `rtsp://127.0.0.1:${port}`;
        return {
            url,
            mediaStreamOptions,
            inputArguments: [
                "-rtsp_transport", "tcp",
                // see above for udp comments.
                // unclear what this does in tcp. out of order packets in a tcp
                // stream probably breaks things.
                // should possibly use the werift jitter buffer in tcp mode to accomodate.
                "-max_delay", "0",
                '-i', url,
            ]
        };
    }
}
