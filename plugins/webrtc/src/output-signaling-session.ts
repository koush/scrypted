import { RTCIceCandidate, RTCPeerConnection } from "@koush/werift";
import { RTCAVSignalingSetup, RTCSignalingOptions, RTCSignalingSendIceCandidate, RTCSignalingSession } from '@scrypted/sdk';
import { createRawResponse } from "./werift-util";

export class WebRTCOutputSignalingSession implements RTCSignalingSession {
    constructor(public pc: RTCPeerConnection) {
    }

    async getOptions(): Promise<RTCSignalingOptions> {
        return;
    }

    async createLocalDescription(type: "offer" | "answer", setup: RTCAVSignalingSetup, sendIceCandidate: RTCSignalingSendIceCandidate): Promise<RTCSessionDescriptionInit> {
        this.pc.onIceCandidate.subscribe(candidate => {
            console.log('local candidate', candidate);
            sendIceCandidate({
                candidate: candidate.candidate,
                sdpMid: candidate.sdpMid,
                sdpMLineIndex: candidate.sdpMLineIndex,
            });
        })

        let ret: RTCSessionDescriptionInit;
        if (type === 'offer') {
            const offer = await this.pc.createOffer();
            await this.pc.setLocalDescription(offer);
            ret = createRawResponse(offer);
        }
        else {
            const answer = await this.pc.createAnswer();
            this.pc.setLocalDescription(answer);
            ret = createRawResponse(answer);
        }
        return ret;
    }

    async setRemoteDescription(description: RTCSessionDescriptionInit, setup: RTCAVSignalingSetup) {
        await this.pc.setRemoteDescription(description as any)
    }

    async addIceCandidate(candidate: RTCIceCandidateInit) {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
}
