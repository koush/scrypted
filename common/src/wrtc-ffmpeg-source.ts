import { RTCAVSignalingOfferSetup, RTCAVMessage, FFMpegInput, MediaManager, MediaStreamOptions } from "@scrypted/sdk/types";
import { listenZeroSingleClient } from "./listen-cluster";
import { RTCPeerConnection, RTCRtpCodecParameters } from "@koush/werift";
import dgram from 'dgram';
import { RtspServer } from "./rtsp-server";
import { Socket } from "net";

function createSdpInput(audioPort: number, videoPort: number) {
    return `v=0
o=- 0 0 IN IP4 127.0.0.1
s=-
c=IN IP4 127.0.0.1
t=0 0
m=audio ${audioPort} UDP 96
a=control:trackID=audio
a=rtpmap:96 opus/48000/2
a=fmtp:96 minptime=10;useinbandfec=1
a=rtcp-fb:96 transport-cc
a=sendrecv
m=video ${videoPort} UDP 97
a=control:trackID=video
a=rtpmap:97 H264/90000
a=rtcp-fb:97 ccm fir
a=rtcp-fb:97 nack
a=rtcp-fb:97 nack pli
a=rtcp-fb:97 goog-remb
a=fmtp:97 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f
a=sendrecv
`;
}

export function getRTCMediaStreamOptions(id: string, name: string, container: string): MediaStreamOptions {
    return {
        // set by consumer
        id,
        name,
        container,
        video: {
            codec: 'h264',
        },
        audio: {
            codec: 'opus',
        },
    };
}

export async function createRTCPeerConnectionSource(avsource: RTCAVSignalingOfferSetup, id: string, name: string, console: Console, sendOffer: (offer: RTCAVMessage) => Promise<RTCAVMessage>): Promise<FFMpegInput> {
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
        pc?.close();
        socket?.destroy();
        clearInterval(ai);
        clearInterval(vi);
        try {
            udp.close();
        }
        catch(e) {
        }
    };

    clientPromise.then(async (client) => {
        socket = client;
        const rtspServer = new RtspServer(socket, createSdpInput(audioPort, videoPort), udp);
        rtspServer.console = console;
        rtspServer.audioChannel = 0;
        rtspServer.videoChannel = 2;
        await rtspServer.handleSetup();

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
            if (pc.iceConnectionState === 'disconnected'
                || pc.iceConnectionState === 'failed'
                || pc.iceConnectionState === 'closed') {
                cleanup();
            }
        });
        pc.connectionStateChange.subscribe(() => {
            if (pc.connectionState === 'closed'
                || pc.connectionState === 'disconnected'
                || pc.connectionState === 'failed') {
                cleanup();
            }
        })

        let gotAudio = false;
        let gotVideo = false;

        const audioTransceiver = pc.addTransceiver("audio", avsource.audio as any);
        audioTransceiver.onTrack.subscribe((track) => {
            audioTransceiver.sender.replaceTrack(track);
            track.onReceiveRtp.subscribe((rtp) => {
                if (!gotAudio) {
                    gotAudio = true;
                    console.log('received first audio packet');
                }
                rtspServer.sendAudio(rtp.serialize(), false);
            });
            track.onReceiveRtcp.subscribe(rtcp => rtspServer.sendAudio(rtcp.serialize(), true));
            track.onReceiveRtp.once(() => ai = setInterval(() => audioTransceiver.receiver.sendRtcpPLI(track.ssrc!), 2000));
        });

        const videoTransceiver = pc.addTransceiver("video", avsource.video as any);
        videoTransceiver.onTrack.subscribe((track) => {
            videoTransceiver.sender.replaceTrack(track);
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

        if (avsource.datachannel)
            pc.createDataChannel(avsource.datachannel.label, avsource.datachannel.dict);

        const gatheringPromise = new Promise(resolve => pc.iceGatheringStateChange.subscribe(resolve));

        let offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        await gatheringPromise;

        offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const offerWithCandidates: RTCAVMessage = {
            id: undefined,
            candidates: [],
            description: {
                sdp: offer.sdp,
                type: 'offer',
            },
            configuration: {},
        };

        console.log('offer sdp', offer.sdp);
        const answer = await sendOffer(offerWithCandidates);
        console.log('answer sdp', answer.description.sdp);
        await pc.setRemoteDescription(answer.description as any);
    })
        .catch(e => cleanup);

    const url = `rtsp://127.0.0.1:${port}`;
    return {
        url,
        mediaStreamOptions: getRTCMediaStreamOptions(id, name, 'rtsp'),
        inputArguments: [
            "-rtsp_transport", "udp",
            "-max_delay", "1000000",
            '-i', url,
        ]
    };
}
