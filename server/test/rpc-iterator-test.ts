import { RpcPeer } from "../src/rpc";

const p1 = new RpcPeer('p1', 'p2', message => {
    console.log('message p1 p2', message);
    p2.handleMessage(message);
});

const p2 = new RpcPeer('p2', 'p1', message => {
    console.log('message p2 p1', message);
    p1.handleMessage(message);
});

async function* generator() {
    yield 2;
    yield 3;
}

p1.params['thing'] = generator();

async function test() {
    const foo = await p2.getParam('thing');
    for await (const n of foo) {
        console.log(n);
    }
}

test();
