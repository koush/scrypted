import { RpcPeer } from "@scrypted/server/src/rpc";
export async function createBrowserSignalingSession(ws, localName, remoteName) {
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
    const session = await peer.getParam('session');
    return session;
}
//# sourceMappingURL=rtc-connect.js.map