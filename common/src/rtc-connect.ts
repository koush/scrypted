import { RpcPeer } from "@scrypted/server/src/rpc";
import type { RTCSignalingSession } from "@scrypted/sdk";

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
