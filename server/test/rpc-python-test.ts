import child_process from 'child_process';
import path from 'path';
import type { Readable, Writable } from "stream";
import { createDuplexRpcPeer } from '../src/rpc-serializer';
import assert from 'assert';

async function main() {

    const cp = child_process.spawn('python3', [path.join(__dirname, '../python/rpc-iterator-test.py')], {
        stdio: ['pipe', 'inherit', 'inherit', 'pipe', 'pipe'],
    });

    cp.on('exit', code => console.log('exited', code))

    const rpcPeer = createDuplexRpcPeer('node', 'python', cp.stdio[3] as Readable, cp.stdio[4] as Writable);

    const foo = await rpcPeer.getParam('foo');
    assert.equal(foo, 3);

    const ticker = await rpcPeer.getParam('ticker');
    for await (const v of ticker) {
        console.log(v);
    }
    process.exit();
}

main();
