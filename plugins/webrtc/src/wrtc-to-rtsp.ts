import { BundlePolicy, RTCIceCandidate, RTCPeerConnection, RtcpPayloadSpecificFeedback, RTCRtpTransceiver, RtpPacket } from "./werift";
// import { FullIntraRequest } from "@koush/werift/lib/rtp/src/rtcp/psfb/fullIntraRequest";
import { FullIntraRequest } from "../../../external/werift/packages/rtp/src/rtcp/psfb/fullIntraRequest";
import { Deferred } from "@scrypted/common/src/deferred";
import { listenZeroSingleClient } from "@scrypted/common/src/listen-cluster";
import { getNaluTypesInNalu, RtspServer } from "@scrypted/common/src/rtsp-server";
import { createSdpInput, parseSdp } from '@scrypted/common/src/sdp-utils';
import sdk, { FFmpegInput, Intercom, MediaObject, MediaStreamUrl, ResponseMediaStreamOptions, RTCAVSignalingSetup, RTCSessionControl, RTCSignalingChannel, RTCSignalingOptions, RTCSignalingSendIceCandidate, RTCSignalingSession, ScryptedMimeTypes } from "@scrypted/sdk";
import { logConnectionState, waitClosed, waitConnected, waitIceConnected } from "./peerconnection-util";
import { startRtpForwarderProcess } from "./rtp-forwarders";
import { getFFmpegRtpAudioOutputArguments, requiredAudioCodecs, requiredVideoCodec } from "./webrtc-required-codecs";
import { createRawResponse, getWeriftIceServers, isPeerConnectionAlive } from "./werift-util";

const { mediaManager } = sdk;

export interface RTCPeerConnectionPipe {
    mediaObject: MediaObject;
    intercom: Promise<Intercom>;
    pcClose: Promise<unknown>;
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

    const sessionControl = new Deferred<RTCSessionControl>();
    const peerConnection = new Deferred<RTCPeerConnection>();
    const intercom = new Deferred<Intercom>();

    const cleanup = () => {
        console.log('webrtc/rtsp cleaning up');
        clientPromise.then(client => client.destroy());
        sessionControl.promise.then(sc => sc.endSession());
        peerConnection.promise.then(pc => pc.close());
        intercom.promise.then(intercom => intercom.stopIntercom());
    };

    clientPromise.then(socket => socket.on('close', cleanup));

    const start = (async () => {
        const client = await clientPromise;
        const rtspServer = new RtspServer(client, undefined, true);
        // rtspServer.console = console;

        const ensurePeerConnection = (setup: RTCAVSignalingSetup) => {
            if (peerConnection.finished)
                return;
            const ret = new RTCPeerConnection({
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

            logConnectionState(console, ret);
            peerConnection.resolve(ret);
        }

        let audioTrack: string;
        let videoTrack: string;
        let audioTransceiver: RTCRtpTransceiver;

        const doSetup = async (setup: RTCAVSignalingSetup) => {
            ensurePeerConnection(setup);

            let gotAudio = false;
            let gotVideo = false;

            const pc = await peerConnection.promise;
            pc.iceConnectionStateChange.subscribe(() => {
                console.log('iceConnectionState', pc.iceConnectionState);
            });
            pc.connectionStateChange.subscribe(() => {
                console.log('connectionState', pc.connectionState);
            });

            const setupAudioTranscevier = (transciever: RTCRtpTransceiver) => {
                audioTransceiver = transciever;
                audioTransceiver.setDirection('sendrecv');
                audioTransceiver.mid = '0';
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
            };

            const setupVideoTransceiver = (transceiver: RTCRtpTransceiver) => {
                const videoTransceiver = transceiver;
                videoTransceiver.mid = '1';
                videoTransceiver.onTrack.subscribe((track) => {
                    console.log('received video track');
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
                        const pictureLossInterval = setInterval(() => {
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
                        waitClosed(pc).then(() => clearInterval(pictureLossInterval));
                    });
                });
            };

            if (setup.type === 'answer') {
                pc.onTransceiverAdded.subscribe(transceiver => {
                    if (transceiver.kind === 'audio') {
                        setupAudioTranscevier(transceiver);
                    }
                    else if (transceiver.kind === 'video') {
                        setupVideoTransceiver(transceiver);
                    }
                });
                return;
            }

            setupAudioTranscevier(pc.addTransceiver("audio", setup.audio as any));
            setupVideoTransceiver(pc.addTransceiver("video", setup.video as any));
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
            __proxy_props = { options: {} };
            options: RTCSignalingOptions = {};

            async getOptions(): Promise<RTCSignalingOptions> {
                return {};
            }

            async createLocalDescription(type: "offer" | "answer", setup: RTCAVSignalingSetup, sendIceCandidate: RTCSignalingSendIceCandidate): Promise<RTCSessionDescriptionInit> {
                if (type === 'offer')
                    await doSetup(setup);
                const pc = await peerConnection.promise;
                if (setup.datachannel) {
                    pc.createDataChannel(setup.datachannel.label, setup.datachannel.dict);
                    // pc.sctpTransport.mid = '2';
                }

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
                    await doSetup(setup);
                else
                    await handleRtspSetup(description);
                const pc = await peerConnection.promise;
                await pc.setRemoteDescription(description as any);
            }
            async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
                console.log('addIceCandidate', candidate.sdpMLineIndex, candidate.candidate)
                const pc = await peerConnection.promise;
                await pc.addIceCandidate(candidate as RTCIceCandidate);
            }
        }

        const session = new SignalingSession();
        const sc = await channel.startRTCSignalingSession(session);
        sessionControl.resolve(sc);
        console.log('waiting for peer connection');
        const pc = await peerConnection.promise;
        console.log('waiting for ice connected');
        await waitIceConnected(pc);

        let destroyProcess: () => void;

        const track = audioTransceiver.sender.sendRtp;

        const ic: Intercom = {
            async startIntercom(media: MediaObject) {
                if (!isPeerConnectionAlive(pc))
                    throw new Error('peer connection is closed');

                if (!track)
                    throw new Error('peer connection does not support two way audio');


                const ffmpegInput = await mediaManager.convertMediaObjectToJSON<FFmpegInput>(media, ScryptedMimeTypes.FFmpegInput);

                const { kill: destroy } = await startRtpForwarderProcess(console, ffmpegInput, {
                    audio: {
                        encoderArguments: getFFmpegRtpAudioOutputArguments(ffmpegInput.mediaStreamOptions?.audio?.codec, audioTransceiver.sender.codec, maximumCompatibilityMode),
                        onRtp: (rtp) => audioTransceiver.sender.sendRtp(rtp),
                    },
                });

                ic.stopIntercom();

                destroyProcess = destroy;

                const sc = await sessionControl.promise;
                sc.setPlayback({
                    audio: true,
                    video: false,
                });
            },
            async stopIntercom() {
                destroyProcess?.();

                sc.setPlayback({
                    audio: false,
                    video: false,
                });
            },
        };

        intercom.resolve(ic);
    })();

    start.catch(e => {
        console.error('session start failed', e);
        sessionControl.reject(e);
        peerConnection.reject(e);
        intercom.reject(e);

        cleanup();
    });

    const pcClose = peerConnection.promise.then(pc => waitClosed(pc));
    pcClose.finally(cleanup);

    peerConnection.promise.catch(e => {
        console.error('failed to create webrtc signaling session', e);
        cleanup();
    });

    const url = `rtsp://127.0.0.1:${port}`;
    const mediaStreamUrl: MediaStreamUrl = {
        url,
        container: 'rtsp',
        mediaStreamOptions,
    };

    return {
        mediaObject: await mediaManager.createMediaObject(mediaStreamUrl, ScryptedMimeTypes.MediaStreamUrl),
        intercom: intercom.promise,
        pcClose,
    };
}

interface ReceivedRtpPacket extends RtpPacket {
    uptime?: number;
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
