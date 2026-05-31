import worker_threads from 'worker_threads';
import { newThread } from "../src/threading";

async function test() {
    const foo = 5;
    const bar = 6;

    console.log(await newThread({
        foo, bar,
    }, async () => {
        return foo + bar;
    }));


    console.log(await newThread({
        foo, bar,
    }, async ({ foo, bar }) => {
        return foo + bar;
    }));

    const sayHelloInMainThread = () => console.log('hello! main thread:', worker_threads.isMainThread);
    await newThread({
        sayHelloInMainThread,
    }, async () => {
        sayHelloInMainThread();
    })
}

test();
