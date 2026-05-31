import net from 'net';
import { listenZeroSingleClient } from "../src/listen-zero";
import { createDuplexRpcPeer } from "../src/rpc-serializer";
import { RpcPeer } from '../src/rpc';

async function test() {
    const { port, clientPromise } = await listenZeroSingleClient('127.0.0.1');


    const n1 = net.connect({
        port,
        host: '127.0.0.1',
    });

    const n2 = await clientPromise;
    console.log('connected');

    const p1 = createDuplexRpcPeer('p1', 'p2', n1, n1);
    const p2 = createDuplexRpcPeer('p2', 'p1', n2, n2);

    const buffers: Buffer[] = [
        Buffer.alloc(10),
        Buffer.alloc(20),
        Buffer.alloc(30),
    ];

    (buffers as any)[RpcPeer.PROPERTY_JSON_COPY_SERIALIZE_CHILDREN] = true;

    p1.params.test = buffers;

    const transfered = await p2.getParam('test');
    console.log(transfered);

    n1.destroy();
    n2.destroy();
}

test();
