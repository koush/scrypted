import { RpcPeer } from "../../server/src/rpc";
import { createRpcSerializer } from "../../server/src/rpc-serializer";
import type { RTCSignalingSession } from "@scrypted/sdk";

export async function createBrowserSignalingSession(ws: WebSocket, localName: string, remoteName: string) {
    const serializer = createRpcSerializer({
        sendMessageBuffer: buffer => ws.send(buffer),
        sendMessageFinish: message => ws.send(JSON.stringify(message)),
    });

    const rpcPeer = new RpcPeer(localName, remoteName, (message, reject, serializationContext) => {
        try {
            serializer.sendMessage(message, reject, serializationContext);
        }
        catch (e) {
            reject?.(e);
        }
    });
    ws.addEventListener('close', () => rpcPeer.kill('WebSocket closed'));

    ws.onmessage = message => {
        const data = message.data;
        if (data.constructor === Buffer || data.constructor === ArrayBuffer) {
            serializer.onMessageBuffer(Buffer.from(data));
        }
        else {
            serializer.onMessageFinish(JSON.parse(data as string));
        }
    };

    serializer.setupRpcPeer(rpcPeer);

    const session: RTCSignalingSession = await rpcPeer.getParam('session');
    return session;
}
