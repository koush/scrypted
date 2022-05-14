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
