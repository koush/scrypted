import type { Readable, Writable } from "stream";
import { SidebandBufferSerializer } from "./rpc-buffer-serializer";
import { RpcPeer } from "./rpc";

export function createDuplexRpcPeer(selfName: string, peerName: string, readable: Readable, writable: Writable) {
    const serializer = createRpcDuplexSerializer(writable);

    const rpcPeer = new RpcPeer(selfName, peerName, (message, reject, serializationContext) => {
        try {
            serializer.sendMessage(message, reject, serializationContext);
        }
        catch (e) {
            reject?.(e);
            readable.destroy();
        }
    });

    serializer.setupRpcPeer(rpcPeer);
    readable.on('data', data => serializer.onData(data));
    readable.on('close', serializer.onDisconnected);
    readable.on('error', serializer.onDisconnected);
    return rpcPeer;
}

export function createRpcSerializer(options: {
    sendMessageBuffer: (buffer: Buffer) => void,
    sendMessageFinish: (message: any) => void,
}) {
    let rpcPeer: RpcPeer;

    const { sendMessageBuffer, sendMessageFinish } = options;
    let connected = true;
    const onDisconnected = () => {
        connected = false;
        rpcPeer.kill('connection closed.');
    }

    const sendMessage = (message: any, reject: (e: Error) => void, serializationContext: any,) => {
        if (!connected) {
            reject?.(new Error('peer disconnected'));
            return;
        }

        const buffers = serializationContext?.buffers;
        if (buffers) {
            for (const buffer of buffers) {
                sendMessageBuffer(buffer);
            }
        }
        sendMessageFinish(message);
    }

    let pendingSerializationContext: any = {};
    const setupRpcPeer = (peer: RpcPeer) => {
        rpcPeer = peer;
        rpcPeer.addSerializer(Buffer, 'Buffer', new SidebandBufferSerializer());
    }

    const onMessageBuffer = (buffer: Buffer) => {
        pendingSerializationContext = pendingSerializationContext || {
            buffers: [],
        };
        const buffers: Buffer[] = pendingSerializationContext.buffers;
        buffers.push(buffer);
    };

    const onMessageFinish = (message: any) => {
        const messageSerializationContext = pendingSerializationContext;
        pendingSerializationContext = undefined;
        rpcPeer.handleMessage(message, messageSerializationContext);
    };

    const kill = (message: string) => {
        rpcPeer.kill(message);
    };

    return {
        kill,
        sendMessage,
        setupRpcPeer,
        onMessageBuffer,
        onMessageFinish,
        onDisconnected,
    };
}

export function createRpcDuplexSerializer(writable: {
    write: (data: Buffer) => void;
}) {
    const socketSend = (type: number, data: Buffer) => {
        const header = Buffer.alloc(5);
        header.writeUInt32BE(data.length + 1, 0);
        header.writeUInt8(type, 4);

        writable.write(Buffer.concat([header, data]));
    }

    const createSocketSend = (type: number) => {
        return (data: Buffer) => {
            return socketSend(type, data);
        }
    }

    const sendMessageBuffer = createSocketSend(1);
    const sendMessageFinish = createSocketSend(0);

    const serializer = createRpcSerializer({
        sendMessageBuffer,
        sendMessageFinish: (message) => sendMessageFinish(Buffer.from(JSON.stringify(message))),
    });

    let header: Buffer;
    let pending: Buffer;

    const readPending = (length: number) => {
        if (!pending || pending.length < length)
            return;

        const ret = pending.slice(0, length);
        pending = pending.slice(length);
        if (!pending.length)
            pending = undefined;
        return ret;
    }

    const onData = (data: Buffer) => {
        if (!pending)
            pending = data;
        else
            pending = Buffer.concat([pending, data]);

        while (true) {
            if (!header) {
                header = readPending(5);
                if (!header)
                    return;
            }

            const length = header.readUInt32BE(0);
            const type = header.readUInt8(4);
            const payload: Buffer = readPending(length - 1);
            if (!payload)
                return;

            header = undefined;

            if (type === 0) {
                try {
                    const message = JSON.parse(payload.toString());
                    serializer.onMessageFinish(message);
                }
                catch (e) {
                    serializer.kill('message parse failure ' + e.message);
                }
            }
            else {
                serializer.onMessageBuffer(payload);
            }
        }
    }

    return {
        onData,
        setupRpcPeer: serializer.setupRpcPeer,
        sendMessage: serializer.sendMessage,
        onDisconnected: serializer.onDisconnected,
    };
}
