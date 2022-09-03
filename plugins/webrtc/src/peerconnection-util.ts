import { RTCPeerConnection } from "@koush/werift";

export function waitConnected(pc: RTCPeerConnection) {
    return new Promise(resolve => {
        if (pc.connectionState === 'connected') {
            resolve(undefined);
            return;
        }
        pc.connectionStateChange.subscribe(() => {
            if (pc.connectionState === 'connected')
                resolve(undefined);
        })
    });
}

export function waitIceConnected(pc: RTCPeerConnection) {
    return new Promise(resolve => {
        const check = () => {
            if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
                resolve(undefined);
            }
        };
        check();
        pc.iceConnectionStateChange.subscribe(check);
    });
}

export function waitClosed(pc: RTCPeerConnection) {
    return new Promise(resolve => {
        pc.iceGatheringStateChange.subscribe(() => {
            console.log('iceGatheringStateChange', pc.iceGatheringState);
        });
        pc.iceConnectionStateChange.subscribe(() => {
            console.log('iceConnectionStateChange', pc.connectionState, pc.iceConnectionState);
            if (pc.iceConnectionState === 'disconnected'
                || pc.iceConnectionState === 'failed'
                || pc.iceConnectionState === 'closed') {
                resolve(undefined);
            }
        });
        pc.connectionStateChange.subscribe(() => {
            console.log('connectionStateChange', pc.connectionState, pc.iceConnectionState);
            if (pc.connectionState === 'closed'
                || pc.connectionState === 'disconnected'
                || pc.connectionState === 'failed') {
                resolve(undefined);
            }
        });
    });
}