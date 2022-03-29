import { listenZeroSingleClient } from "@scrypted/common/src/listen-cluster";
import { Output, Pipeline, RTCPeerConnection, RtcpPacket, RtcpPayloadSpecificFeedback, RTCRtpCodecParameters, RTCRtpTransceiver, RTCSessionDescription, RtpPacket, uint16Add } from "@koush/werift";
import dgram from 'dgram';
import { RtspServer } from "@scrypted/common/src/rtsp-server";
import { Socket } from "net";
import sdk, { RTCSignalingChannel, FFMpegInput, MediaStreamOptions, RTCSessionControl, RTCSignalingSendIceCandidate, RTCSignalingSession, RTCAVSignalingSetup, RTCSignalingOptions, MediaObject, Intercom, ScryptedMimeTypes } from "@scrypted/sdk";
import { FullIntraRequest } from "@koush/werift/lib/rtp/src/rtcp/psfb/fullIntraRequest";
import { createSdpInput } from '@scrypted/common/src/sdp-utils'
import { createRawResponse, isPeerConnectionAlive } from "./werift-util";
import { ChildProcess } from "child_process";
import { safeKillFFmpeg } from "@scrypted/common/src/media-helpers";
import { createTrackForwarders, getFFmpegRtpAudioOutputArguments, startRtpForwarderProcess } from "./rtp-forwarders";

const { mediaManager } = sdk;

export interface RTCPeerConnectionPipe {
    ffmpegInput: FFMpegInput;
    intercom: Promise<Intercom>;
}

export async function createRTCPeerConnectionSource(options: {
    console: Console,
    mediaStreamOptions: MediaStreamOptions,
    channel: RTCSignalingChannel,
    useUdp: boolean,
}): Promise<RTCPeerConnectionPipe> {
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

    const pcPromise = clientPromise.then(async (client) => {
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
        pc.iceGatheringStateChange.subscribe(() => {
            console.log('iceGatheringStateChange', pc.iceGatheringState);
        });
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

        let audioTransceiver: RTCRtpTransceiver;
        const doSetup = async (setup: RTCAVSignalingSetup) => {
            let gotAudio = false;
            let gotVideo = false;

            audioTransceiver = pc.addTransceiver("audio", setup.audio as any);
            audioTransceiver.onTrack.subscribe((track) => {
                if (useUdp) {
                    track.onReceiveRtp.subscribe(rtp => {
                        if (!gotAudio) {
                            gotAudio = true;
                            console.log('received first audio packet');
                        }
                        rtspServer.sendAudio(rtp.serialize(), false);
                    });
                    track.onReceiveRtcp.subscribe(rtp => rtspServer.sendAudio(rtp.serialize(), true));
                }
                else {
                    const jitter = new JitterBuffer({
                        rtpStream: track.onReceiveRtp,
                        rtcpStream: track.onReceiveRtcp,
                    });
                    class RtspOutput extends Output {
                        pushRtcpPackets(packets: RtcpPacket[]): void {
                            for (const rtcp of packets) {
                                rtspServer.sendAudio(rtcp.serialize(), true)
                            }
                        }
                        pushRtpPackets(packets: RtpPacket[]): void {
                            if (!gotAudio) {
                                gotAudio = true;
                                console.log('received first audio packet');
                            }
                            for (const rtp of packets) {
                                rtspServer.sendAudio(rtp.serialize(), false);
                            }
                        }
                    }
                    jitter.pipe(new RtspOutput())
                }
            });

            const videoTransceiver = pc.addTransceiver("video", setup.video as any);
            videoTransceiver.onTrack.subscribe((track) => {
                if (useUdp) {
                    track.onReceiveRtp.subscribe(rtp => {
                        if (!gotVideo) {
                            gotVideo = true;
                            console.log('received first video packet');
                        }
                        rtspServer.sendVideo(rtp.serialize(), false);
                    });
                    track.onReceiveRtcp.subscribe(rtp => rtspServer.sendVideo(rtp.serialize(), true));
                }
                else {
                    const jitter = new JitterBuffer({
                        rtpStream: track.onReceiveRtp,
                        rtcpStream: track.onReceiveRtcp,
                    });
                    class RtspOutput extends Output {
                        pushRtcpPackets(packets: RtcpPacket[]): void {
                            for (const rtcp of packets) {
                                rtspServer.sendVideo(rtcp.serialize(), true)
                            }
                        }
                        pushRtpPackets(packets: RtpPacket[]): void {
                            if (!gotVideo) {
                                gotVideo = true;
                                console.log('received first video packet');
                            }
                            for (const rtp of packets) {
                                rtspServer.sendVideo(rtp.serialize(), false);
                            }
                        }
                    }
                    jitter.pipe(new RtspOutput())
                }

                track.onReceiveRtp.once(() => {
                    let firSequenceNumber = 0;
                    pictureLossInterval = setInterval(() => {
                        // i think this is necessary for older clients like ring
                        // which is really a sip gateway?
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

                        // from my testing with browser clients, the pli is what
                        // triggers a i-frame to be sent, and not the prior FIR request.
                        videoTransceiver.receiver.sendRtcpPLI(track.ssrc!);
                    }, 4000);
                });
            });
        }

        const handleRtspSetup = async (description: RTCSessionDescriptionInit) => {
            if (description.type !== 'answer')
                return;

            rtspServer.sdp = createSdpInput(audioPort, videoPort, description.sdp);
            console.log('sdp sent', rtspServer.sdp);

            if (useUdp) {
                rtspServer.udpPorts = {
                    video: videoPort,
                    audio: audioPort,
                };
                rtspServer.client.write(rtspServer.sdp + '\r\n');
                rtspServer.client.end();
                rtspServer.client.on('data', () => { });
                // rtspServer.client.destroy();
            }
            else {
                await rtspServer.handleSetup();
            }
        }

        class SignalingSession implements RTCSignalingSession {
            getOptions(): Promise<RTCSignalingOptions> {
                return;
            }

            async createLocalDescription(type: "offer" | "answer", setup: RTCAVSignalingSetup, sendIceCandidate: RTCSignalingSendIceCandidate): Promise<RTCSessionDescriptionInit> {
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

                const handleRawResponse = async (response: RTCSessionDescription): Promise<RTCSessionDescriptionInit> => {
                    const ret = createRawResponse(response);
                    await handleRtspSetup(ret);
                    return ret;
                }

                if (type === 'answer') {
                    let answer = await pc.createAnswer();
                    console.log('sdp received', answer.sdp);
                    const set = pc.setLocalDescription(answer);
                    if (sendIceCandidate)
                        return handleRawResponse(answer);
                    await set;
                    await gatheringPromise;
                    answer = pc.localDescription || answer;
                    return handleRawResponse(answer);
                }
                else {
                    let offer = await pc.createOffer();
                    // console.log(offer.sdp);
                    const set = pc.setLocalDescription(offer);
                    if (sendIceCandidate)
                        return handleRawResponse(offer);
                    await set;
                    await gatheringPromise;
                    offer = await pc.createOffer();
                    return handleRawResponse(offer);
                }
            }
            async setRemoteDescription(description: RTCSessionDescriptionInit, setup: RTCAVSignalingSetup): Promise<void> {
                if (description.type === 'offer')
                    doSetup(setup);

                await handleRtspSetup(description);
                await pc.setRemoteDescription(description as any);
            }
            async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
                await pc.addIceCandidate(candidate as RTCIceCandidate);
            }

        }

        sessionControl = await channel.startRTCSignalingSession(new SignalingSession());
        console.log('session setup complete');

        return pc;
    });

    pcPromise.catch(e => {
        console.error('failed to create webrtc signaling session', e);
        cleanup();
    });

    const intercom = pcPromise
        .then(async (pc) => {
            await pc.connectionStateChange.watch(state => state === 'connected');

            const audioTransceiver = pc.transceivers.find(t => t.kind === 'audio');

            let talkbackProcess: ChildProcess;

            const track = audioTransceiver.sender.sendRtp;

            const ret: Intercom = {
                async startIntercom(media: MediaObject) {
                    if (!isPeerConnectionAlive(pc))
                        throw new Error('peer connection is closed');

                    if (!track)
                        throw new Error('peer connection does not support two way audio');

                    const ffmpegInput = await mediaManager.convertMediaObjectToJSON<FFMpegInput>(media, ScryptedMimeTypes.FFmpegInput);

                    const { cp } = await startRtpForwarderProcess(console, ffmpegInput.inputArguments, {
                        audio: {
                            outputArguments: getFFmpegRtpAudioOutputArguments(),
                            transceiver: audioTransceiver,
                        },
                    });

                    ret.stopIntercom();

                    talkbackProcess = cp;
                },
                async stopIntercom() {
                    safeKillFFmpeg(talkbackProcess);
                    talkbackProcess = undefined;
                },
            };

            return ret;
        });

    let ffmpegInput: FFMpegInput;
    if (useUdp) {
        const url = `tcp://127.0.0.1:${port}`;

        mediaStreamOptions.container = 'sdp';
        ffmpegInput = {
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
        ffmpegInput = {
            url,
            mediaStreamOptions,
            inputArguments: [
                "-rtsp_transport", "tcp",
                // see above for udp comments.
                // unclear what this does in tcp. out of order packets in a tcp
                // stream probably breaks things.
                // should possibly use the werift jitter buffer in tcp mode to accomodate.
                // "-max_delay", "0",
                '-i', url,
            ]
        };
    }

    return {
        ffmpegInput,
        intercom,
    }
}

interface ReceivedRtpPacket extends RtpPacket {
    uptime?: number;
}

export class JitterBuffer extends Pipeline {
    private buffer: ReceivedRtpPacket[] = [];

    // the number of packets to wait before giving up on a packet.
    // 1/10th of a second.
    maxDelay = .1

    pushRtpPackets(packets: RtpPacket[]) {
        packets.forEach(this.onRtp);
    }

    pushRtcpPackets(packets: RtcpPacket[]) {
        this.children?.pushRtcpPackets?.(packets);
    }

    private onRtp = (p: RtpPacket) => {
        const now = process.uptime();
        const received = p as ReceivedRtpPacket;
        received.uptime = now;

        this.buffer.push(received);
        this.buffer.sort((a, b) => a.header.timestamp - b.header.timestamp);

        // find sequenced packets
        let send = 0;
        while (this.buffer.length > send + 1 && uint16Add(this.buffer[send].header.sequenceNumber, 1) === this.buffer[send + 1].header.sequenceNumber) {
            send++;
        }

        // send sequenced packets
        if (send) {
            const packets = this.buffer.splice(0, send);
            this.children?.pushRtpPackets?.(packets);
        }

        // find dated packets
        send = 0;
        while (this.buffer.length > send && this.buffer[send].uptime + this.maxDelay < now) {
            send++;
        }

        // send dated packets
        if (send) {
            const packets = this.buffer.splice(0, send);
            this.children?.pushRtpPackets?.(packets);
        }
    };
}

export function getRTCMediaStreamOptions(id: string, name: string, useUdp: boolean): MediaStreamOptions {
    return {
        // set by consumer
        id,
        name,
        // not compatible with scrypted parser currently due to jitter issues
        tool: useUdp ? undefined : 'scrypted',
        container: useUdp ? 'sdp' : 'rtsp',
        video: {
            codec: 'h264',
        },
        audio: {
            codec: 'opus',
        },
    };
}
