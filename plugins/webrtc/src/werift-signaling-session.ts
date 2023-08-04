import { RTCIceCandidate, RTCPeerConnection } from "./werift";
import { RTCAVSignalingSetup, RTCSignalingOptions, RTCSignalingSendIceCandidate, RTCSignalingSession } from '@scrypted/sdk';
import { createRawResponse } from "./werift-util";
import { sleep } from "@scrypted/common/src/sleep";

export class WeriftSignalingSession implements RTCSignalingSession {
    remoteDescription: Promise<any>;
    __proxy_props: { options: {}; };
    options: RTCSignalingOptions = {};

    constructor(public console: Console, public pc: RTCPeerConnection) {
    }

    async getOptions(): Promise<RTCSignalingOptions> {
        return {};
    }

    async createLocalDescription(type: "offer" | "answer", setup: RTCAVSignalingSetup, sendIceCandidate: RTCSignalingSendIceCandidate): Promise<RTCSessionDescriptionInit> {
        // werift turn does not seem to work? maybe? sometimes it does? we ignore it here, and that's fine as only 1 side
        // needs turn.
        // stun candidates will come through here, if connection is slow to establish.
        this.pc.onIceCandidate.subscribe(candidate => {
            // this.console.log('local candidate', candidate.candidate);
            sendIceCandidate?.({
                candidate: candidate.candidate,
                sdpMid: candidate.sdpMid,
                sdpMLineIndex: candidate.sdpMLineIndex,
            });
        });

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
            if (!sendIceCandidate)
                await this.remoteDescription;
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
        this.remoteDescription = this.pc.setRemoteDescription(description as any);
    }

    async addIceCandidate(candidate: RTCIceCandidateInit) {
        // todo: fix this in werift or verify it still occurs at later point
        // werift seems to choose whatever candidate pair results in the fastest connection.
        // this makes it sometimes choose the STUN or TURN candidate even when
        // on the local network.
        if (candidate.candidate?.includes('relay'))
            await sleep(500);
        else if (candidate.candidate?.includes('srflx'))
            await sleep(250);
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
}
