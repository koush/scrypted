import { RTCPeerConnection } from "./werift";

interface Event {
    subscribe: (execute: () => void) => {
        unSubscribe: () => void;
    };
}

async function statePromise(e: Event, check: () => boolean): Promise<void> {
    if (check())
        return;

    return new Promise((r, f) => {
        const u = e.subscribe(() => {
            try {
                if (check()) {
                    u.unSubscribe();
                    r(undefined);
                }
            }
            catch (e) {
                u.unSubscribe();
                f(e);
            }
        });
    })
}

function isPeerConnectionClosed(pc: RTCPeerConnection) {
    return (pc.connectionState === 'closed'
        || pc.connectionState === 'disconnected'
        || pc.connectionState === 'failed')
}

export function waitConnected(pc: RTCPeerConnection) {
    return statePromise(pc.connectionStateChange, () => {
        if (isPeerConnectionClosed(pc))
            throw new Error('peer connection closed');
        return pc.connectionState === 'connected';
    })
}

function isPeerIceConnectionClosed(pc: RTCPeerConnection) {
    return (pc.iceConnectionState === 'disconnected'
        || pc.iceConnectionState === 'failed'
        || pc.iceConnectionState === 'closed')
}

export function waitIceConnected(pc: RTCPeerConnection) {
    return statePromise(pc.iceConnectionStateChange, () => {
        if (isPeerIceConnectionClosed(pc))
            throw new Error('peer ice connection closed');
        return pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed';
    })
}

export function waitClosed(pc: RTCPeerConnection) {
    const connectPromise = statePromise(pc.connectionStateChange, () => {
        return isPeerConnectionClosed(pc);
    });
    const iceConnectPromise = statePromise(pc.iceConnectionStateChange, () => {
        return isPeerIceConnectionClosed(pc);
    });
    return Promise.any([connectPromise, iceConnectPromise]);
}

export function logConnectionState(console: Console, pc: RTCPeerConnection) {
    pc.iceConnectionStateChange.subscribe(() => console.log('iceConnectionState', pc.iceConnectionState));
    pc.iceGatheringStateChange.subscribe(() => console.log('iceGatheringState', pc.iceGatheringState));
    pc.signalingStateChange.subscribe(() => console.log('signalingState', pc.signalingState));
    pc.connectionStateChange.subscribe(() => console.log('connectionState', pc.connectionState));
}
