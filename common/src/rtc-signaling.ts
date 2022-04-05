import { RpcPeer } from "@scrypted/server/src/rpc";
import type { RTCSignalingSendIceCandidate, RTCSignalingSession, RTCAVSignalingSetup, RTCSignalingOptions } from "@scrypted/sdk/types";
// import type { RTCPeerConnection as WeriftRTCPeerConnection } from "@koush/werift";

export async function startRTCSignalingSession(session: RTCSignalingSession, offer: RTCSessionDescriptionInit,
    console: Console,
    createSetup: () => Promise<RTCAVSignalingSetup>,
    setRemoteDescription: (remoteDescription: RTCSessionDescriptionInit) => Promise<RTCSessionDescriptionInit>,
    addIceCandidate?: (candidate: RTCIceCandidate) => Promise<void>) {
    try {
        const setup = await createSetup();
        // console.log('offer', offer?.sdp, 'rtc setup', setup);
        if (!offer) {
            console.log('session.createLocalDescription');
            const offer = await session.createLocalDescription('offer', setup, addIceCandidate);
            console.log('rtc offer created', offer.sdp);
            const answer = await setRemoteDescription(offer);
            console.log('rtc answer received', answer.sdp);
            await session.setRemoteDescription(answer, setup);
            console.log('session.setRemoteDescription done');
        }
        else {
            console.log('session.setRemoteDescription', offer.sdp);
            await session.setRemoteDescription(offer, setup);
            console.log('session.createLocalDescription');
            const answer = await session.createLocalDescription('answer', setup, addIceCandidate);
            console.log('rtc answer created', answer.sdp);
            await setRemoteDescription(answer);
            console.log('session.setRemoteDescription done');
        }
    }
    catch (e) {
        console.error('RTC signaling failed', e);
        throw e;
    }
}

export async function connectRTCSignalingClients(
    console: Console,
    offerClient: RTCSignalingSession,
    offerSetup: Partial<RTCAVSignalingSetup>,
    answerClient: RTCSignalingSession,
    answerSetup: Partial<RTCAVSignalingSetup>,
    disableAnswerTrickle?: boolean,
) {
    offerSetup.type = 'offer';
    answerSetup.type = 'answer';

    const offer = await offerClient.createLocalDescription('offer', offerSetup as RTCAVSignalingSetup, candidate => answerClient.addIceCandidate(candidate));
    console.log('offer sdp', offer.sdp);
    await answerClient.setRemoteDescription(offer, answerSetup as RTCAVSignalingSetup);
    const answer = await answerClient.createLocalDescription('answer', answerSetup as RTCAVSignalingSetup, disableAnswerTrickle ? undefined : candidate => offerClient.addIceCandidate(candidate));
    console.log('answer sdp', answer.sdp);
    await offerClient.setRemoteDescription(answer, offerSetup as RTCAVSignalingSetup);
}

export class BrowserSignalingSession implements RTCSignalingSession {
    pc: RTCPeerConnection;
    options: RTCSignalingOptions = {
        capabilities: {
            audio: RTCRtpReceiver.getCapabilities?.('audio') || {
                codecs: undefined,
                headerExtensions: undefined,
            },
            video: RTCRtpReceiver.getCapabilities?.('video') || {
                codecs: undefined,
                headerExtensions: undefined,
            },
        }
    };

    constructor(public peerConnectionCreated?: (pc: RTCPeerConnection) => Promise<void>, public cleanup?: () => void) {

    }

    async getOptions(): Promise<RTCSignalingOptions> {
        return this.options;
    }

    async createPeerConnection(setup: RTCAVSignalingSetup) {
        if (this.pc)
            return;

        const checkConn = () => {
            console.log('iceConnectionState', pc.iceConnectionState);
            console.log('connectionState', pc.connectionState);
            if (pc.iceConnectionState === 'disconnected'
                || pc.iceConnectionState === 'failed'
                || pc.iceConnectionState === 'closed') {
                this.cleanup?.();
            }
            if (pc.connectionState === 'closed'
                || pc.connectionState === 'disconnected'
                || pc.connectionState === 'failed') {
                this.cleanup?.();
            }
        }

        const pc = this.pc = new RTCPeerConnection(setup.configuration);
        await this.peerConnectionCreated?.(pc);

        pc.addEventListener('connectionstatechange', checkConn);
        pc.addEventListener('iceconnectionstatechange', checkConn);

        pc.addEventListener('icegatheringstatechange', ev => console.log('iceGatheringState', pc.iceGatheringState))
        pc.addEventListener('signalingstatechange', ev => console.log('signalingState', pc.signalingState))
        pc.addEventListener('icecandidateerror', ev => console.log('icecandidateerror'))

        if (setup.datachannel)
            this.pc.createDataChannel(setup.datachannel.label, setup.datachannel.dict);
        if (setup.audio.direction === 'sendrecv' || setup.audio.direction === 'sendonly') {
            try {
                // doing sendrecv on safari requires a mic be attached, or it fails to connect.
                const mic = await navigator.mediaDevices.getUserMedia({ video: false, audio: true })
                for (const track of mic.getTracks()) {
                    this.pc.addTrack(track);
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
                this.pc.addTrack(silence());
            }
        }
        else {
            this.pc.addTransceiver('audio', setup.audio);
        }

        if (setup.video.direction === 'sendrecv' || setup.video.direction === 'sendonly') {
            try {
                // doing sendrecv on safari requires a mic be attached, or it fails to connect.
                const camera = await navigator.mediaDevices.getUserMedia({ video: true })
                for (const track of camera.getTracks()) {
                    this.pc.addTrack(track);
                }
            }
            catch (e) {
                // what now
            }
        }
        else {
            this.pc.addTransceiver('video', setup.video);
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
            console.log('local description', init.sdp);
            return {
                type: init.type,
                sdp: init.sdp,
            }
        }

        if (type === 'offer') {
            let offer = await this.pc.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true,
            });
            const set = this.pc.setLocalDescription(offer);
            if (sendIceCandidate)
                return toDescription(offer);
            await set;
            await gatheringPromise;
            offer = await this.pc.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true,
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
        await this.pc.setRemoteDescription(description);
        console.log('remote description', description.sdp);
    }

    async addIceCandidate(candidate: RTCIceCandidateInit) {
        await this.pc.addIceCandidate(candidate);
        console.log("remote candidate", candidate);
    }

    async endSession() {
    }
}

export async function createBrowserSignalingSession(ws: WebSocket, localName: string, remoteName: string) {
    const peer = new RpcPeer(localName, remoteName, (message, reject) => {
        const json = JSON.stringify(message);
        try {
            ws.send(json);
        }
        catch (e) {
            reject?.(e);
        }
    });
    ws.onmessage = message => {
        const json = JSON.parse(message.data);
        peer.handleMessage(json);
    };

    const session: RTCSignalingSession = await peer.getParam('session');
    return session;
}
