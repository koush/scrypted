import { RpcPeer } from "../src/rpc";
import { sleep } from '../src/sleep';

const p1 = new RpcPeer('p1', 'p2', message => {
    // console.log('message p1 p2', message);
    p2.handleMessage(message);
});

const p2 = new RpcPeer('p2', 'p1', message => {
    // console.log('message p2 p1', message);
    p1.handleMessage(message);
});

async function* generator() {
    try {
        yield 2;
        yield 3;
    }
    catch (e) {
        console.log('caught', e)
    }
}

p1.params['thing'] = generator();

async function test() {
    const foo = await p2.getParam('thing') as AsyncGenerator<number>;
    if (true) {
        for await (const c of foo) {
            console.log(c);
        }
    }
    else {
        await sleep(0);
        console.log(await foo.next());
        await sleep(0);
        // await foo.throw(new Error('barf'));
        await foo.return(44);
        await sleep(0);
        console.log(await foo.next());
        console.log(await foo.next());
    }

}

test();
