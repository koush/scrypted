import { RTCIceCandidate, RTCPeerConnection } from "./werift";
import { RTCAVSignalingSetup, RTCSignalingOptions, RTCSignalingSendIceCandidate, RTCSignalingSession } from '@scrypted/sdk';
import { createRawResponse } from "./werift-util";
import { sleep } from "@scrypted/common/src/sleep";
import ip from 'ip';

function isV6Only(address: string) {
    return !ip.isV4Format(address) && ip.isV6Format(address);
}

export class WeriftSignalingSession implements RTCSignalingSession {
    remoteDescription: Promise<any>;
    __proxy_props: { options: {}; };
    options: RTCSignalingOptions = {};

    constructor(public console: Console, public pc: RTCPeerConnection) {
    }

    async getOptions(): Promise<RTCSignalingOptions> {
        return {};
    }

    localHasV6 = false;
    async createLocalDescription(type: "offer" | "answer", setup: RTCAVSignalingSetup, sendIceCandidate: RTCSignalingSendIceCandidate): Promise<RTCSessionDescriptionInit> {
        // werift turn does not seem to work? maybe? sometimes it does? we ignore it here, and that's fine as only 1 side
        // needs turn.
        // stun candidates will come through here, if connection is slow to establish.
        this.pc.onIceCandidate.subscribe(candidate => {
            this.localHasV6 ||= isV6Only(candidate.candidate?.split(' ')?.[4]);

            // this.console.log('local candidate', candidate.candidate);

            sendIceCandidate?.({
                candidate: candidate.candidate,
                sdpMid: candidate.sdpMid,
                sdpMLineIndex: candidate.sdpMLineIndex,
            });
        });

        let ret: RTCSessionDescriptionInit;
        if (type === 'offer') {
            let offer = await this.pc.createOffer();
            if (!sendIceCandidate)
                offer = (await this.pc.setLocalDescription(offer)).toJSON();
            else
                this.pc.setLocalDescription(offer);
            ret = createRawResponse(offer);
        }
        else {
            if (!sendIceCandidate)
                await this.remoteDescription;
            let answer = await this.pc.createAnswer();
            if (!sendIceCandidate)
                answer = (await this.pc.setLocalDescription(answer)).toJSON();
            else
                this.pc.setLocalDescription(answer);
            ret = createRawResponse(answer);
        }
        return ret;
    }

    async setRemoteDescription(description: RTCSessionDescriptionInit, setup: RTCAVSignalingSetup) {
        this.remoteDescription = this.pc.setRemoteDescription(description as any);
    }

    remoteHasV6 = false;
    async addIceCandidate(candidate: RTCIceCandidateInit) {
        this.remoteHasV6 ||= isV6Only(candidate.candidate?.split(' ')?.[4]);

        if (candidate.candidate?.includes('relay')) {
            // note: this code is done, werift was modified to ban bad ips like 6to4 relays from tmobile.

            // todo: fix this in werift or verify it still occurs at later point
            // werift seems to choose whatever candidate pair results in the fastest connection.
            // this makes it sometimes choose the STUN or TURN candidate even when
            // on the local network.
            // if (this.remoteHasV6 && !this.localHasV6) {
            //     this.console.log('Possible mobile network IPv6to4 translation detected.');
            // }
            // else {
            //     await sleep(500);
            // }

            await sleep(500);
        }
        else if (candidate.candidate?.includes('srflx')) {
            await sleep(250);
        }

        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
}