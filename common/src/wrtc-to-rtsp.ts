import { RTCAVSignalingSetup, RTCSignalingChannel, FFMpegInput, MediaStreamOptions } from "@scrypted/sdk/types";
import { listenZeroSingleClient } from "./listen-cluster";
import { RTCPeerConnection, RTCRtpCodecParameters } from "@koush/werift";
import dgram from 'dgram';
import { RtspServer } from "./rtsp-server";
import { Socket } from "net";
import { ScryptedDeviceBase } from "@scrypted/sdk";
import { parsePayloadTypes } from './sdp-utils';


// this is an sdp corresponding to what is requested from webrtc.
// h264 baseline and opus are required codecs that all webrtc implementations must provide.
function createSdpInput(audioPort: number, videoPort: number, sdp: string) {
    const { audioPayloadTypes, videoPayloadTypes } = parsePayloadTypes(sdp);

    return `v=0
o=- 0 0 IN IP4 127.0.0.1
s=-
c=IN IP4 127.0.0.1
t=0 0
m=audio ${audioPort} UDP ${[...audioPayloadTypes].join(' ')}
a=control:trackID=audio
a=rtpmap:101 opus/48000/2
a=fmtp:101 minptime=10;useinbandfec=1
a=rtcp-fb:101 transport-cc
a=sendrecv
m=video ${videoPort} UDP ${[...videoPayloadTypes].join(' ')}
a=control:trackID=video
a=rtpmap:96 H264/90000
a=rtcp-fb:96 ccm fir
a=rtcp-fb:96 nack
a=rtcp-fb:96 nack pli
a=rtcp-fb:96 goog-remb
a=fmtp:96 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f
a=sendrecv
`;
}

const useUdp = false;

export function getRTCMediaStreamOptions(id: string, name: string): MediaStreamOptions {
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

export async function createRTCPeerConnectionSource(channel: ScryptedDeviceBase & RTCSignalingChannel, id: string): Promise<FFMpegInput> {
    const { console, name } = channel;
    const videoPort = Math.round(Math.random() * 10000 + 30000);
    const audioPort = Math.round(Math.random() * 10000 + 30000);

    const { clientPromise, port } = await listenZeroSingleClient();

    let ai: NodeJS.Timeout;
    let vi: NodeJS.Timeout;
    let pc: RTCPeerConnection;
    let socket: Socket;
    // rtsp server must operate in udp forwarding mode to accomodate packet reordering.
    let udp = dgram.createSocket('udp4');

    const cleanup = () => {
        console.log('cleanup');
        pc?.close();
        socket?.destroy();
        clearInterval(ai);
        clearInterval(vi);
        try {
            udp.close();
        }
        catch (e) {
        }
    };

    clientPromise.then(async (client) => {
        socket = client;
        const rtspServer = new RtspServer(socket, undefined, udp);
        // rtspServer.console = console;
        rtspServer.audioChannel = 0;
        rtspServer.videoChannel = 2;

        const pc = new RTCPeerConnection({
            codecs: {
                audio: [
                    new RTCRtpCodecParameters({
                        mimeType: "audio/opus",
                        clockRate: 48000,
                        channels: 2,
                    })
                ],
                video: [
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
            // if (pc.iceConnectionState === 'disconnected'
            //     || pc.iceConnectionState === 'failed'
            //     || pc.iceConnectionState === 'closed') {
            //     cleanup();
            // }
        });
        pc.connectionStateChange.subscribe(() => {
            console.log('connectionStateChange', pc.connectionState, pc.iceConnectionState);
            // if (pc.connectionState === 'closed'
            //     || pc.connectionState === 'disconnected'
            //     || pc.connectionState === 'failed') {
            //     cleanup();
            // }
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
                track.onReceiveRtcp.subscribe(rtcp => rtspServer.sendAudio(rtcp.serialize(), true));
            });

            const videoTransceiver = pc.addTransceiver("video", setup.video as any);
            videoTransceiver.onTrack.subscribe((track) => {
                // videoTransceiver.sender.replaceTrack(track);
                track.onReceiveRtp.subscribe((rtp) => {
                    if (!gotVideo) {
                        gotVideo = true;
                        console.log('received first video packet');
                    }
                    rtspServer.sendVideo(rtp.serialize(), false);
                });
                track.onReceiveRtcp.subscribe(rtcp => rtspServer.sendVideo(rtcp.serialize(), true))
                track.onReceiveRtp.once(() => {
                    vi = setInterval(() => videoTransceiver.receiver.sendRtcpPLI(track.ssrc!), 2000);
                });
            });
        }

        channel.startRTCSignalingSession({
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
                    const set = pc.setLocalDescription(answer);
                    if (sendIceCandidate)
                        return answer as any;
                    await set;
                    await gatheringPromise;
                    answer = pc.localDescription || answer;
                    return answer as any;
                }
                else {
                    let offer = await pc.createOffer();
                    const set = pc.setLocalDescription(offer);
                    if (sendIceCandidate)
                        return offer as any;
                    await set;
                    await gatheringPromise;
                    offer = await pc.createOffer();
                    return offer as any;
                }
            },
            setRemoteDescription: async (description: RTCSessionDescriptionInit, setup: RTCAVSignalingSetup) => {
                if (description.type === 'offer')
                    doSetup(setup);
                await pc.setRemoteDescription(description as any);
                rtspServer.sdp = createSdpInput(audioPort, videoPort, description.sdp);
                await rtspServer.handleSetup();
            },
            addIceCandidate: async (candidate: RTCIceCandidateInit) => {
                await pc.addIceCandidate(candidate as RTCIceCandidate);
            }
        });
    })
        .catch(e => cleanup);

    const url = `rtsp://127.0.0.1:${port}`;
    return {
        url,
        mediaStreamOptions: getRTCMediaStreamOptions(id, name),
        inputArguments: [
            "-rtsp_transport", useUdp ? "udp" : "tcp",
            // hint to ffmpeg for how long to wait for out of order packets.
            // is only used by udp, i think? unsure. but it causes severe jitter.
            // the jitter buffer should be on the actual rendering side.
            // "-max_delay", "0",
            '-i', url,
        ]
    };
}
