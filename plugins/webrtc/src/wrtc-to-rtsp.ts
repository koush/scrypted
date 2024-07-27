import { Deferred } from "@scrypted/common/src/deferred";
import { listenZeroSingleClient } from "@scrypted/common/src/listen-cluster";
import { getNaluTypesInNalu, RtspServer } from "@scrypted/common/src/rtsp-server";
import { createSdpInput, parseSdp } from '@scrypted/common/src/sdp-utils';
import sdk, { FFmpegInput, Intercom, MediaObject, MediaStreamUrl, ResponseMediaStreamOptions, RTCAVSignalingSetup, RTCSessionControl, RTCSignalingChannel, RTCSignalingOptions, RTCSignalingSendIceCandidate, RTCSignalingSession, ScryptedMimeTypes, ScryptedNativeId } from "@scrypted/sdk";
import { FullIntraRequest } from "../../../external/werift/packages/rtp/src/rtcp/psfb/fullIntraRequest";
import { logConnectionState, waitClosed, waitConnected, waitIceConnected } from "./peerconnection-util";
import { startRtpForwarderProcess } from "./rtp-forwarders";
import { getFFmpegRtpAudioOutputArguments, requiredAudioCodecs, requiredVideoCodec } from "./webrtc-required-codecs";
import { BundlePolicy, RTCIceCandidate, RTCPeerConnection, RtcpPayloadSpecificFeedback, RTCRtpTransceiver, RtpPacket } from "./werift";
import { createRawResponse, getWeriftIceServers, isPeerConnectionAlive, logIsLocalIceTransport } from "./werift-util";

const { mediaManager } = sdk;

export interface RTCPeerConnectionPipe {
    __json_copy_serialize_children: true,
    mediaObject: MediaObject;
    getIntercom(): Promise<Intercom>;
    pcClose(): Promise<unknown>;
}

function ignoreDeferred(...d: Deferred<any>[]) {
    d.forEach(d => d.promise.catch(() => { }));
}

function ignorePromise(...p: Promise<any>[]) {
    p.forEach(p => p.catch(() => { }));
}

export async function createRTCPeerConnectionSource(options: {
    mixinId: string,
    nativeId: ScryptedNativeId,
    mediaStreamOptions: ResponseMediaStreamOptions,
    startRTCSignalingSession: (session: RTCSignalingSession) => Promise<RTCSessionControl | undefined>,
    maximumCompatibilityMode: boolean,
}): Promise<RTCPeerConnectionPipe> {
    const { mediaStreamOptions, startRTCSignalingSession, mixinId, nativeId, maximumCompatibilityMode } = options;
    const console = mixinId ? sdk.deviceManager.getMixinConsole(mixinId, nativeId) : sdk.deviceManager.getDeviceConsole(nativeId);

    const { clientPromise, port } = await listenZeroSingleClient('127.0.0.1');

    const timeStart = Date.now();

    const sessionControl = new Deferred<RTCSessionControl>();
    const peerConnection = new Deferred<RTCPeerConnection>();
    const intercom = new Deferred<Intercom>();
    ignoreDeferred(sessionControl, intercom);

    const cleanup = () => {
        console.log('webrtc/rtsp cleaning up');
        clientPromise.then(client => client.destroy()).catch(() => { });
        sessionControl.promise.then(sc => sc.endSession()).catch(() => { });
        peerConnection.promise.then(pc => pc.close()).catch(() => { });
        ignorePromise(intercom.promise.then(intercom => intercom.stopIntercom()));
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

            waitClosed(ret).then(() => cleanup());

            logConnectionState(console, ret);
            peerConnection.resolve(ret);

            (async () => {
                try {
                    if (ret.remoteIsBundled)
                        await waitConnected(ret);
                    else
                        await waitIceConnected(ret);
                    logIsLocalIceTransport(console, ret);
                }
                catch (e) {
                }
            })();
        }

        let audioTrack: string;
        let videoTrack: string;
        let audioTransceiver: RTCRtpTransceiver;

        const doSetup = async (setup: RTCAVSignalingSetup) => {
            ensurePeerConnection(setup);

            let gotAudio = false;
            let gotVideo = false;

            const pc = await peerConnection.promise;
            const timeout = setTimeout(() => cleanup(), 2 * 60 * 1000);
            waitClosed(pc).then(() => clearTimeout(timeout));

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
                        clearTimeout(timeout);
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
        const sc = await startRTCSignalingSession(session);
        sessionControl.resolve(sc);
        console.log('waiting for peer connection');
        const pc = await peerConnection.promise;
        console.log('waiting for ice connected');
        await waitIceConnected(pc);

        let destroyProcess: () => void;

        const ic: Intercom & { __json_copy_serialize_children: true } = {
            __json_copy_serialize_children: true,
            async startIntercom(media: MediaObject) {
                if (!isPeerConnectionAlive(pc))
                    throw new Error('peer connection is closed');

                const audioCodec = audioTransceiver?.sender?.codec;
                if (!audioTransceiver?.sender?.sendRtp || !audioCodec)
                    throw new Error('peer connection does not support two way audio');


                const ffmpegInput = await mediaManager.convertMediaObjectToJSON<FFmpegInput>(media, ScryptedMimeTypes.FFmpegInput);

                let lastPacketTs: number = 0;
                const { kill: destroy } = await startRtpForwarderProcess(console, ffmpegInput, {
                    audio: {
                        codecCopy: audioCodec.name,
                        encoderArguments: getFFmpegRtpAudioOutputArguments(ffmpegInput.mediaStreamOptions?.audio, audioTransceiver.sender.codec, maximumCompatibilityMode),
                        onRtp: (rtp) => {
                            const packet = RtpPacket.deSerialize(rtp);
                            const now = Date.now();
                            packet.header.payloadType = audioCodec.payloadType;
                            packet.header.marker = now - lastPacketTs > 1000; // set the marker if it's been more than 1s since the last packet
                            audioTransceiver.sender.sendRtp(packet.serialize());
                            lastPacketTs = now;
                        },
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
        __json_copy_serialize_children: true,
        mediaObject: await mediaManager.createMediaObject(mediaStreamUrl, ScryptedMimeTypes.MediaStreamUrl),
        getIntercom: () => intercom.promise,
        pcClose: () => pcClose,
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
