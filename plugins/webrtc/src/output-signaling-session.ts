import { RTCIceCandidate, RTCPeerConnection } from "@koush/werift";
import { RTCAVSignalingSetup, RTCSignalingOptions, RTCSignalingSendIceCandidate, RTCSignalingSession } from '@scrypted/sdk';
import { createRawResponse } from "./werift-util";

export class WeriftOutputSignalingSession implements RTCSignalingSession {
    constructor(public pc: RTCPeerConnection) {
    }

    async getOptions(): Promise<RTCSignalingOptions> {
        return;
    }

    async createLocalDescription(type: "offer" | "answer", setup: RTCAVSignalingSetup, sendIceCandidate: RTCSignalingSendIceCandidate): Promise<RTCSessionDescriptionInit> {
        // werift turn does not seem to work, but that's fine as only 1 side
        // needs turn.
        // stun candidates will come through here, if connection is slow to establish.
        this.pc.onIceCandidate.subscribe(candidate => {
            console.log('local candidate', candidate.candidate);
            sendIceCandidate?.({
                candidate: candidate.candidate,
                sdpMid: candidate.sdpMid,
                sdpMLineIndex: candidate.sdpMLineIndex,
            });
        })

        let ret: RTCSessionDescriptionInit;
        if (type === 'offer') {
            const offer = await this.pc.createOffer();
            if (!sendIceCandidate)
                await this.pc.setLocalDescription(offer);
            else
                this.pc.setLocalDescription(offer);
            ret = createRawResponse(offer);
        }
        else {
            const answer = await this.pc.createAnswer();
            if (!sendIceCandidate)
                await this.pc.setLocalDescription(answer);
            else
                this.pc.setLocalDescription(answer);
            ret = createRawResponse(answer);
        }
        return ret;
    }

    async setRemoteDescription(description: RTCSessionDescriptionInit, setup: RTCAVSignalingSetup) {
        this.pc.setRemoteDescription(description as any)
    }

    async addIceCandidate(candidate: RTCIceCandidateInit) {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
}
