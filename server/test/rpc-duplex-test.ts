import net from 'net';
import { listenZeroSingleClient } from "../src/listen-zero";
import { createDuplexRpcPeer } from "../src/rpc-serializer";

async function test() {
    const { port, clientPromise } = await listenZeroSingleClient();


    const n1 = net.connect({
        port,
        host: '127.0.0.1',
    });

    const n2 = await clientPromise;
    console.log('connected');

    const p1 = createDuplexRpcPeer('p1', 'p2', n1, n1);
    const p2 = createDuplexRpcPeer('p2', 'p1', n2, n2);

    p1.params.test = () => console.log('p1 test');
    p2.params.test = () => console.log('p2 test');

    await (await p1.getParam('test'))();
    await (await p2.getParam('test'))();

    n1.destroy();
    n2.destroy();
}

test();
