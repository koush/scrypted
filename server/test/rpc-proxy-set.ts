import { RpcPeer } from "../src/rpc";

const p1 = new RpcPeer('p1', 'p2', message => {
    p2.handleMessage(message);
});

const p2 = new RpcPeer('p2', 'p1', message => {
    p1.handleMessage(message);
});

class Foo {
}

p1.params['thing'] = new Foo();

async function test() {
    const foo = await p2.getParam('thing');
    foo.bar = 3;
    if (foo.bar !== 3)
        throw new Error('proxy custom property set failed');
}

test();
