import type { RTCSignalingSession, RTCAVSignalingSetup, ScryptedDevice, RTCSignalingChannel } from "@scrypted/sdk/types";
import type { RTCSignalingChannelOptions, RTCSignalingSendIceCandidate } from "@scrypted/sdk";

export async function startRTCSignalingSession(session: RTCSignalingSession, offer: RTCSessionDescriptionInit,
    createSetup: () => Promise<RTCAVSignalingSetup>,
    setRemoteDescription: (remoteDescription: RTCSessionDescriptionInit) => Promise<RTCSessionDescriptionInit>,
    addIceCandidate?: (candidate: RTCIceCandidate) => Promise<void>) {
    const setup = await createSetup();
    if (!offer) {
        const offer = await session.createLocalDescription('offer', setup, addIceCandidate);
        const answer = await setRemoteDescription(offer);
        await session.setRemoteDescription(answer, setup);
    }
    else {
        await session.setRemoteDescription(offer, setup);
        const answer = await session.createLocalDescription('answer', setup, addIceCandidate);
        await setRemoteDescription(answer);
    }
}

export class BrowserSignalingSession implements RTCSignalingSession {
    hasSetup = false;
    options: RTCSignalingChannelOptions = {
        capabilities: {
            audio: RTCRtpReceiver.getCapabilities('audio'),
            video: RTCRtpReceiver.getCapabilities('video'),
        }
    };

    constructor(public pc: RTCPeerConnection, cleanup: () => void) {
        const checkConn = () => {
            console.log('iceConnectionState state', pc.iceConnectionState);
            console.log('connectionState', pc.connectionState);
            if (pc.iceConnectionState === 'disconnected'
                || pc.iceConnectionState === 'failed'
                || pc.iceConnectionState === 'closed') {
                cleanup();
            }
            if (pc.connectionState === 'closed'
                || pc.connectionState === 'disconnected'
                || pc.connectionState === 'failed') {
                cleanup();
            }
        }

        pc.addEventListener('connectionstatechange', checkConn);
        pc.addEventListener('iceconnectionstatechange', checkConn);
    }

    createPeerConnection(setup: RTCAVSignalingSetup) {
        if (this.hasSetup)
            return;
        this.hasSetup = true;
        if (setup.datachannel)
            this.pc.createDataChannel(setup.datachannel.label, setup.datachannel.dict);
        this.pc.addTransceiver('audio', setup.audio);
        this.pc.addTransceiver('video', setup.video);
    }

    async createLocalDescription(type: "offer" | "answer", setup: RTCAVSignalingSetup, sendIceCandidate: RTCSignalingSendIceCandidate) {
        this.createPeerConnection(setup);

        const gatheringPromise = new Promise(resolve => this.pc.onicegatheringstatechange = () => {
            if (this.pc.iceGatheringState === 'complete')
                resolve(undefined);
        });

        if (sendIceCandidate) {
            this.pc.onicecandidate = ev => {
                if (ev.candidate) {
                    console.log("local candidate", ev.candidate);
                    sendIceCandidate(JSON.parse(JSON.stringify(ev.candidate)));
                }
            }
        }

        const toDescription = (init: RTCSessionDescriptionInit) => {
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

    }
    async addIceCandidate(candidate: RTCIceCandidateInit) {
        console.log("remote candidate", candidate);
        await this.pc.addIceCandidate(candidate);
    }
}
