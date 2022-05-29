import { BundlePolicy, Pipeline, RTCPeerConnection, RtcpPacket, RtcpPayloadSpecificFeedback, RTCRtpTransceiver, RtpPacket, uint16Add } from "@koush/werift";
import { FullIntraRequest } from "@koush/werift/lib/rtp/src/rtcp/psfb/fullIntraRequest";
import { listenZeroSingleClient } from "@scrypted/common/src/listen-cluster";
import { getNaluTypesInNalu, RtspServer } from "@scrypted/common/src/rtsp-server";
import { createSdpInput, parseSdp } from '@scrypted/common/src/sdp-utils';
import sdk, { FFmpegInput, Intercom, MediaObject, MediaStreamUrl, ResponseMediaStreamOptions, RTCAVSignalingSetup, RTCSessionControl, RTCSignalingChannel, RTCSignalingOptions, RTCSignalingSendIceCandidate, RTCSignalingSession, ScryptedMimeTypes } from "@scrypted/sdk";
import dgram from 'dgram';
import { Socket } from "net";
import { waitConnected } from "./peerconnection-util";
import { getFFmpegRtpAudioOutputArguments, startRtpForwarderProcess } from "./rtp-forwarders";
import { requiredAudioCodecs, requiredVideoCodec } from "./webrtc-required-codecs";
import { createRawResponse, getWeriftIceServers, isPeerConnectionAlive, logIsPrivateIceTransport } from "./werift-util";

const { mediaManager } = sdk;

export interface RTCPeerConnectionPipe {
    mediaObject: MediaObject;
    intercom: Promise<Intercom>;
}

export async function createRTCPeerConnectionSource(options: {
    console: Console,
    mediaStreamOptions: ResponseMediaStreamOptions,
    channel: RTCSignalingChannel,
    maximumCompatibilityMode: boolean,
}): Promise<RTCPeerConnectionPipe> {
    const { mediaStreamOptions, channel, console, maximumCompatibilityMode } = options;

    const { clientPromise, port } = await listenZeroSingleClient();

    const timeStart = Date.now();

    let pictureLossInterval: NodeJS.Timeout;
    let socket: Socket;
    // rtsp server must operate in udp forwarding mode to accomodate packet reordering.
    let udp = dgram.createSocket('udp4');
    let sessionControl: RTCSessionControl;

    const cleanup = () => {
        console.log('webrtc/rtsp cleaning up');
        pcPromise.then(pc => pc.close());
        socket?.destroy();
        clearInterval(pictureLossInterval);
        try {
            udp.close();
        }
        catch (e) {
        }
        sessionControl?.endSession().catch(() => { });
    };

    clientPromise.then(socket => {
        socket.on('close', cleanup);
        socket.on('error', cleanup);
    });

    const pcPromise = new Promise<RTCPeerConnection>(async (resolve, reject) => {
        socket = await clientPromise;
        const rtspServer = new RtspServer(socket, undefined, udp);
        // rtspServer.console = console;

        let pc: RTCPeerConnection;

        const ensurePeerConnection = (setup: RTCAVSignalingSetup) => {
            if (pc)
                return;
            pc = new RTCPeerConnection({
                bundlePolicy: setup.configuration?.bundlePolicy as BundlePolicy,
                codecs: {
                    audio: [
                        ...requiredAudioCodecs,
                    ],
                    video: [
                        requiredVideoCodec,
                    ],
                },
                iceServers: getWeriftIceServers(setup.configuration),
            });
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

            waitConnected(pc).then(() => {
                console.log('connected', Date.now() - timeStart);
                logIsPrivateIceTransport(console, pc);
                sessionControl.startSession().catch(() => { });
            });

            resolve(pc);
        }

        let audioTrack: string;
        let videoTrack: string;
        let audioTransceiver: RTCRtpTransceiver;

        const doSetup = async (setup: RTCAVSignalingSetup) => {
            ensurePeerConnection(setup);

            let gotAudio = false;
            let gotVideo = false;

            audioTransceiver = pc.addTransceiver("audio", setup.audio as any);
            audioTransceiver.onTrack.subscribe((track) => {
                track.onReceiveRtp.subscribe(rtp => {
                    if (!gotAudio) {
                        gotAudio = true;
                        console.log('first audio packet', Date.now() - timeStart);
                    }
                    rtspServer.sendTrack(audioTrack, rtp.serialize(), false);
                });
                track.onReceiveRtcp.subscribe(rtp => rtspServer.sendTrack(audioTrack, rtp.serialize(), true));
            });

            const videoTransceiver = pc.addTransceiver("video", setup.video as any);
            videoTransceiver.onTrack.subscribe((track) => {
                track.onReceiveRtp.subscribe(rtp => {
                    if (!gotVideo) {
                        gotVideo = true;
                        console.log('first video packet', Date.now() - timeStart);
                        const naluTypes = getNaluTypesInNalu(rtp.payload);
                        console.log('video packet types', ...[...naluTypes]);
                    }
                    rtspServer.sendTrack(videoTrack, rtp.serialize(), false);
                });
                track.onReceiveRtcp.subscribe(rtp => rtspServer.sendTrack(videoTrack, rtp.serialize(), true));

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
                throw new Error('rtsp setup needs answer sdp');

            rtspServer.sdp = createSdpInput(0, 0, description.sdp);
            const parsedSdp = parseSdp(rtspServer.sdp);
            audioTrack = parsedSdp.msections.find(msection => msection.type === 'audio').control;
            videoTrack = parsedSdp.msections.find(msection => msection.type === 'video').control;
            // console.log('sdp sent', rtspServer.sdp);

            await rtspServer.handlePlayback();
            console.log('rtsp server playback started');
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

                if (sendIceCandidate) {
                    pc.onicecandidate = ev => {
                        console.log('sendIceCandidate', ev.candidate.sdpMLineIndex, ev.candidate.candidate);
                        sendIceCandidate({
                            ...ev.candidate,
                        });
                    };
                }

                if (type === 'answer') {
                    let answer = await pc.createAnswer();
                    console.log('createLocalDescription', answer.sdp)
                    const ret = createRawResponse(answer);
                    await handleRtspSetup(ret);
                    const set = pc.setLocalDescription(answer);
                    if (sendIceCandidate)
                        return ret;
                    await set;
                    await gatheringPromise;
                    answer = pc.localDescription || answer;
                    return createRawResponse(answer);
                }
                else {
                    let offer = await pc.createOffer();
                    console.log('createLocalDescription', offer.sdp)
                    const set = pc.setLocalDescription(offer);
                    if (sendIceCandidate)
                        return createRawResponse(offer);
                    await set;
                    await gatheringPromise;
                    offer = await pc.createOffer();
                    return createRawResponse(offer);
                }
            }
            async setRemoteDescription(description: RTCSessionDescriptionInit, setup: RTCAVSignalingSetup): Promise<void> {
                console.log('setRemoteDescription', description.sdp)
                if (description.type === 'offer')
                    doSetup(setup);
                else
                    await handleRtspSetup(description);
                await pc.setRemoteDescription(description as any);
            }
            async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
                console.log('addIceCandidate', candidate.sdpMLineIndex, candidate.candidate)
                await pc.addIceCandidate(candidate as RTCIceCandidate);
            }

        }

        sessionControl = await channel.startRTCSignalingSession(new SignalingSession());
        console.log('session setup complete');
    });

    pcPromise.catch(e => {
        console.error('failed to create webrtc signaling session', e);
        cleanup();
    });

    const intercom = pcPromise
        .then(async (pc) => {
            await waitConnected(pc);

            const audioTransceiver = pc.transceivers.find(t => t.kind === 'audio');

            let destroyProcess: () => void;

            const track = audioTransceiver.sender.sendRtp;

            const ret: Intercom = {
                async startIntercom(media: MediaObject) {
                    if (!isPeerConnectionAlive(pc))
                        throw new Error('peer connection is closed');

                    if (!track)
                        throw new Error('peer connection does not support two way audio');

                    const ffmpegInput = await mediaManager.convertMediaObjectToJSON<FFmpegInput>(media, ScryptedMimeTypes.FFmpegInput);

                    const { kill: destroy } = await startRtpForwarderProcess(console, ffmpegInput, {
                        audio: {
                            outputArguments: getFFmpegRtpAudioOutputArguments(ffmpegInput.mediaStreamOptions?.audio?.codec, maximumCompatibilityMode),
                            onRtp: (rtp) => audioTransceiver.sender.sendRtp(rtp),
                        },
                    });

                    ret.stopIntercom();

                    destroyProcess = destroy;
                },
                async stopIntercom() {
                    destroyProcess();
                },
            };

            return ret;
        });

    const url = `rtsp://127.0.0.1:${port}`;
    const mediaStreamUrl: MediaStreamUrl = {
        url,
        container: 'rtsp',
        mediaStreamOptions,
    };

    return {
        mediaObject: await mediaManager.createMediaObject(mediaStreamUrl, ScryptedMimeTypes.MediaStreamUrl),
        intercom,
    };
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

export function getRTCMediaStreamOptions(id: string, name: string): ResponseMediaStreamOptions {
    return {
        // set by consumer
        id,
        name,
        // not compatible with scrypted parser currently due to jitter issues
        tool: 'scrypted',
        container: 'rtsp',
        video: {
            codec: 'h264',
        },
        audio: {
        },
    };
}
