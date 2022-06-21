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
            if (pc.iceConnectionState === 'disconnected'
                || pc.iceConnectionState === 'failed'
                || pc.iceConnectionState === 'closed') {
                resolve(pc.iceConnectionState);
            }
        });
    });
}
