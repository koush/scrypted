import { RTCAVMessage, FFMpegInput, MediaManager, ScryptedMimeTypes } from "@scrypted/sdk/types";
import child_process from 'child_process';
import net from 'net';
import { listenZero, listenZeroSingleClient } from "./listen-cluster";
import { ffmpegLogInitialOutput } from "./media-helpers";
import { RTCPeerConnection, RTCRtpCodecParameters } from "werift";
import dgram from 'dgram';

function createSdpInput(audioPort: number, videoPort: number) {
    return `v=0
o=- 0 0 IN IP4 127.0.0.1
s=-
c=IN IP4 127.0.0.1
t=0 0
m=audio ${audioPort} UDP 96
a=rtpmap:96 opus/48000/2
a=fmtp:96 minptime=10;useinbandfec=1
a=rtcp-fb:96 transport-cc
a=sendrecv
m=video ${videoPort} UDP 97
a=rtpmap:97 H264/90000
a=rtcp-fb:97 ccm fir
a=rtcp-fb:97 nack
a=rtcp-fb:97 nack pli
a=rtcp-fb:97 goog-remb
a=fmtp:97 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f
a=sendrecv
`;
}

export async function createRTCPeerConnectionSource(console: Console, mediaManager: MediaManager, sendOffer: (offer: RTCAVMessage) => Promise<RTCAVMessage>): Promise<{
    ffmpegInput: FFMpegInput,
    peerConnection: RTCPeerConnection,
}> {
    const udp = dgram.createSocket("udp4");
    const videoPort = Math.round(Math.random() * 40000 + 10000);
    const audioPort = Math.round(Math.random() * 40000 + 10000);

    const sdpInput = await listenZeroSingleClient();
    sdpInput.clientPromise.then(client => {
        client.write(createSdpInput(audioPort, videoPort));
        client.destroy();
    })

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

    const audioTransceiver = pc.addTransceiver("audio", { direction: "recvonly" });
    audioTransceiver.onTrack.subscribe((track) => {
        audioTransceiver.sender.replaceTrack(track);
        track.onReceiveRtp.subscribe((rtp) => {
            udp!.send(rtp.serialize(), audioPort, "127.0.0.1");
        });
    });

    const videoTransceiver = pc.addTransceiver("video", { direction: "recvonly" });
    videoTransceiver.onTrack.subscribe((track) => {
        videoTransceiver.sender.replaceTrack(track);
        track.onReceiveRtp.subscribe((rtp) => {
            udp!.send(rtp.serialize(), videoPort, "127.0.0.1");
        });
        track.onReceiveRtp.once(() => {
            setInterval(() => videoTransceiver.receiver.sendRtcpPLI(track.ssrc!), 2000);
        });
    });

    pc.createDataChannel('dataSendChannel', { id: 1 });

    let offer = await pc.createOffer();
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
    const answer = await sendOffer(offerWithCandidates);
    await pc.setRemoteDescription(answer.description as any);

    return {
        peerConnection: pc,
        ffmpegInput: {
            url: undefined,
            inputArguments: [
                '-i', sdpInput.url,
            ]
        },
    };
}
