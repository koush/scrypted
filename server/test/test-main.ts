import { RpcPeer} from "../src/rpc";

const peer1: RpcPeer = new RpcPeer(message => peer2.handleMessage(message));
const peer2: RpcPeer = new RpcPeer(message => peer1.handleMessage(message));

class Foo {
    async bar(fiz: Fiz) {
        console.log('bar');
        return await fiz.baz(fiz);
    }

    chain(): Foo {
        console.log('chain');
        return this;
    }

    chain2(): Foo {
        console.log('chain2');
        return this;
    }

    async poop(): Promise<Poop> {
        return new Poop();
    }
    
}

class Poop {
}

class Fiz {

    async buzz() {
        console.log('buzz');
    }

    async baz(fiz: Fiz) {
        console.log('baz');
        await fiz.buzz();
        return 3;
    }
}

peer2.params['foo'] = new Foo();

async function start() {
    const fiz = new Fiz();
    setInterval(async () => {
        await peer1.eval('return foo.poop();');
    }, 100);

    // const foo = await peer1.eval('return foo;') as Foo;
    // console.log(await foo.chain().chain2());
    // const result = await foo.bar(fiz);
    // console.log(result);
}

start();