import type { RTCSignalingSendIceCandidate, RTCSignalingSession, RTCAVSignalingSetup, RTCSignalingOptions } from "@scrypted/sdk/types";
import { Deferred } from "./deferred";

function getUserAgent() {
    try {
        return navigator.userAgent;
    }
    catch (e) {
    }
}

// connectionState is not implemented in firefox? so watch iceConnectionState instead...
export function waitPeerConnectionIceConnected(pc: RTCPeerConnection) {
    return new Promise((resolve, reject) => {
        if (pc.iceConnectionState === 'connected') {
            resolve(undefined);
            return;
        }
        pc.addEventListener('iceconnectionstatechange', () => {
            if (pc.iceConnectionState === 'connected')
                resolve(undefined);
        });

        waitPeerIceConnectionClosed(pc).then(reason => reject(new Error(reason)));
    });
}

export function waitPeerIceConnectionClosed(pc: RTCPeerConnection): Promise<string> {
    return new Promise(resolve => {
        pc.addEventListener('iceconnectionstatechange', () => {
            if (isPeerConnectionClosed(pc)) {
                resolve(pc.iceConnectionState);
            }
        });
    });
}

export function isPeerConnectionClosed(pc: RTCPeerConnection) {
    return pc.iceConnectionState === 'disconnected'
        || pc.iceConnectionState === 'failed'
        || pc.iceConnectionState === 'closed';
}

export class BrowserSignalingSession implements RTCSignalingSession {
    private pc: RTCPeerConnection;
    pcDeferred = new Deferred<RTCPeerConnection>();
    dcDeferred = new Deferred<RTCDataChannel>();
    options: RTCSignalingOptions = {
        userAgent: getUserAgent(),
        capabilities: {
            audio: RTCRtpReceiver.getCapabilities?.('audio') || {
                codecs: undefined,
                headerExtensions: undefined,
            },
            video: RTCRtpReceiver.getCapabilities?.('video') || {
                codecs: undefined,
                headerExtensions: undefined,
            },
        },
        screen: {
            width: screen.width,
            height: screen.height,
        },
    };

    constructor() {
    }

    async getOptions(): Promise<RTCSignalingOptions> {
        return this.options;
    }

    close() {
        this.pcDeferred.promise.then(pc => {
            for (const t of pc.getTransceivers() || []) {
                try {
                    t.sender?.track?.stop?.();
                }
                catch (e) {
                }
            }
            pc.close();
        })
        .catch(() => {});
        this.pcDeferred.reject(new Error('iceConnectionState ' + this.pc?.iceConnectionState));
    }

    async createPeerConnection(setup: RTCAVSignalingSetup) {
        if (this.pc)
            return;

        const checkConn = () => {
            console.log('iceConnectionState', pc.iceConnectionState);
            console.log('connectionState', pc.connectionState);
            if (isPeerConnectionClosed(pc))
                this.close();
        }

        const pc = this.pc = new RTCPeerConnection(setup.configuration);
        this.pcDeferred.resolve(pc);

        pc.addEventListener('connectionstatechange', checkConn);
        pc.addEventListener('iceconnectionstatechange', checkConn);

        pc.addEventListener('icegatheringstatechange', ev => console.log('iceGatheringState', pc.iceGatheringState))
        pc.addEventListener('signalingstatechange', ev => console.log('signalingState', pc.signalingState))
        pc.addEventListener('icecandidateerror', ev => console.log('icecandidateerror'))

        if (setup.datachannel) {
            const dc = pc.createDataChannel(setup.datachannel.label, setup.datachannel.dict);
            dc.binaryType = 'arraybuffer';
            this.dcDeferred.resolve(dc);
        }

        if (setup.audio) {
            if (setup.audio.direction === 'sendrecv' || setup.audio.direction === 'sendonly') {
                try {
                    // doing sendrecv on safari requires a mic be attached, or it fails to connect.
                    const mic = await navigator.mediaDevices.getUserMedia({ video: false, audio: true })
                    for (const track of mic.getTracks()) {
                        pc.addTrack(track);
                    }
                }
                catch (e) {
                    let silence = () => {
                        let ctx = new AudioContext(), oscillator = ctx.createOscillator();
                        const dest = ctx.createMediaStreamDestination();
                        oscillator.connect(dest);
                        oscillator.start();
                        return Object.assign(dest.stream.getAudioTracks()[0], { enabled: false });
                    }
                    pc.addTrack(silence());
                }
            }
            else {
                pc.addTransceiver('audio', setup.audio);
            }
        }

        if (setup.video) {
            if (setup.video.direction === 'sendrecv' || setup.video.direction === 'sendonly') {
                try {
                    // doing sendrecv on safari requires a mic be attached, or it fails to connect.
                    const camera = await navigator.mediaDevices.getUserMedia({ video: true })
                    for (const track of camera.getTracks()) {
                        pc.addTrack(track);
                    }
                }
                catch (e) {
                    // what now
                }
            }
            else {
                pc.addTransceiver('video', setup.video);
            }
        }
    }

    async createLocalDescription(type: "offer" | "answer", setup: RTCAVSignalingSetup, sendIceCandidate: RTCSignalingSendIceCandidate) {
        await this.createPeerConnection(setup);

        const gatheringPromise = new Promise(resolve => {
            this.pc.onicecandidate = ev => {
                if (ev.candidate) {
                    console.log("local candidate", ev.candidate);
                    sendIceCandidate?.(JSON.parse(JSON.stringify(ev.candidate)));
                }
                else {
                    resolve(undefined);
                }
            }

            this.pc.onicegatheringstatechange = () => {
                if (this.pc.iceGatheringState === 'complete')
                    resolve(undefined);
            }
        });

        const toDescription = (init: RTCSessionDescriptionInit) => {
            // console.log('local description', init.sdp);
            return {
                type: init.type,
                sdp: init.sdp,
            }
        }

        if (type === 'offer') {
            let offer = await this.pc.createOffer({
                offerToReceiveAudio: !!setup.audio,
                offerToReceiveVideo: !!setup.video,
            });
            const set = this.pc.setLocalDescription(offer);
            if (sendIceCandidate)
                return toDescription(offer);
            await set;
            await gatheringPromise;
            offer = await this.pc.createOffer({
                offerToReceiveAudio: !!setup.audio,
                offerToReceiveVideo: !!setup.video,
            });
            return toDescription(offer);
        }
        else {
            let answer = await this.pc.createAnswer();
            const set = this.pc.setLocalDescription(answer);
            if (sendIceCandidate)
                return toDescription(answer);
            await set;
            await gatheringPromise;
            answer = this.pc.currentLocalDescription || answer;
            return toDescription(answer);
        }
    }

    async setRemoteDescription(description: RTCSessionDescriptionInit, setup: RTCAVSignalingSetup) {
        await this.createPeerConnection(setup);
        await this.pc.setRemoteDescription(description);
        // console.log('remote description', description.sdp);
    }

    async addIceCandidate(candidate: RTCIceCandidateInit) {
        await this.pc.addIceCandidate(candidate);
        // console.log("remote candidate", candidate);
    }

    async endSession() {
    }
}

function logSendCandidate(console: Console, type: string, session: RTCSignalingSession): RTCSignalingSendIceCandidate {
    return async (candidate) => {
        // console.log(`${type} trickled candidate:`, candidate.sdpMLineIndex, candidate.candidate);
        return session.addIceCandidate(candidate);
    }
}

function createCandidateQueue(console: Console, type: string, session: RTCSignalingSession) {
    let ready = false;
    let candidateQueue: RTCIceCandidateInit[] = [];
    const ls = logSendCandidate(console, type, session);
    const queueSendCandidate: RTCSignalingSendIceCandidate = async (candidate: RTCIceCandidateInit) => {
        if (!ready)
            candidateQueue.push(candidate)
        else
            ls(candidate);
    }

    return {
        flush() {
            ready = true;
            for (const candidate of candidateQueue) {
                ls(candidate);
            }
            candidateQueue = [];
        },
        queueSendCandidate,
    }
}

export async function connectRTCSignalingClients(
    console: Console,
    offerClient: RTCSignalingSession,
    offerSetup: Partial<RTCAVSignalingSetup>,
    answerClient: RTCSignalingSession,
    answerSetup: Partial<RTCAVSignalingSetup>
) {
    const offerOptions = await offerClient.getOptions();
    const answerOptions = await answerClient.getOptions();
    const disableTrickle = offerOptions?.disableTrickle || answerOptions?.disableTrickle;

    if (offerOptions?.offer && answerOptions?.offer)
        throw new Error('Both RTC clients have offers and can not negotiate. Consider implementing this in @scrypted/webrtc.');

    if (offerOptions?.requiresOffer && answerOptions.requiresOffer)
        throw new Error('Both RTC clients require offers and can not negotiate.');

    offerSetup.type = 'offer';
    answerSetup.type = 'answer';

    const answerQueue = createCandidateQueue(console, 'offer', answerClient);
    const offerQueue = createCandidateQueue(console, 'answer', offerClient);

    const offer = await offerClient.createLocalDescription('offer', offerSetup as RTCAVSignalingSetup,
        disableTrickle ? undefined : answerQueue.queueSendCandidate);
    // console.log('offer sdp', offer.sdp);
    await answerClient.setRemoteDescription(offer, answerSetup as RTCAVSignalingSetup);
    answerQueue.flush();
    const answer = await answerClient.createLocalDescription('answer', answerSetup as RTCAVSignalingSetup,
        disableTrickle ? undefined : offerQueue.queueSendCandidate);
    // console.log('answer sdp', answer.sdp);
    await offerClient.setRemoteDescription(answer, offerSetup as RTCAVSignalingSetup);
    offerQueue.flush();
}
