import { ScryptedDeviceBase, StreamService } from "@scrypted/sdk";
import { IPty, spawn as ptySpawn } from 'node-pty-prebuilt-multiarch';
import { createAsyncQueue } from '@scrypted/common/src/async-queue'
import { ChildProcess, spawn as childSpawn } from "child_process";

export const TerminalServiceNativeId = 'terminalservice';


class InteractiveTerminal {
    cp: IPty

    constructor() {
        const spawn = require('node-pty-prebuilt-multiarch').spawn as typeof ptySpawn;
        this.cp = spawn(process.env.SHELL as string, [], {});
    }

    onExit(fn: (e: { exitCode: number; signal?: number; }) => any) {
        this.cp.onExit(fn)
    };

    onData(fn: (e: string) => any) {
        this.cp.onData(fn);
    }

    pause() {
        this.cp.pause();
    }

    resume() {
        this.cp.resume();
    }

    write(data: string) {
        this.cp.write(data);
    }

    sendEOF() {
        // not supported
    }

    kill(signal?: string) {
        this.cp.kill(signal);
    }

    resize(columns: number, rows: number) {
        this.cp.resize(columns, rows);
    }
}

class NoninteractiveTerminal {
    cp: ChildProcess

    constructor() {
        this.cp = childSpawn(process.env.SHELL as string);
    }

    onExit(fn: (code: number, signal: NodeJS.Signals) => void) {
        return this.cp.on("close", fn);
    }

    onData(fn: { (chunk: any): void; (chunk: any): void; }) {
        this.cp.stdout.on("data", fn);
        this.cp.stderr.on("data", fn);
    }

    pause() {
        this.cp.stdout.pause();
        this.cp.stderr.pause();
    }

    resume() {
        this.cp.stdout.pause();
        this.cp.stderr.pause();
    }

    write(data: any) {
        this.cp.stdin.write(data);
    }

    sendEOF() {
        this.cp.stdin.end();
    }

    kill(signal?: number | NodeJS.Signals) {
        this.cp.kill(signal);
    }

    resize(columns: number, rows: number) {
        // not supported
    }
}


export class TerminalService extends ScryptedDeviceBase implements StreamService {
    async connectStream(input: AsyncGenerator<any, void>): Promise<AsyncGenerator<any, void>> {
        let cp: InteractiveTerminal | NoninteractiveTerminal = null;
        const queue = createAsyncQueue<Buffer>();

        function registerChildListeners() {
            cp.onExit(() => queue.end());

            let bufferedLength = 0;
            const MAX_BUFFERED_LENGTH = 64000;
            cp.onData(async data => {
                const buffer = Buffer.from(data);
                bufferedLength += buffer.length;
                const promise = queue.enqueue(buffer).then(() => bufferedLength -= buffer.length);
                if (bufferedLength >= MAX_BUFFERED_LENGTH) {
                    cp.pause();
                    await promise;
                    if (bufferedLength < MAX_BUFFERED_LENGTH)
                        cp.resume();
                }
            });
        }

        async function* generator() {
            try {
                while (true) {
                    const buffers = queue.clear();
                    if (buffers.length) {
                        yield Buffer.concat(buffers);
                        continue;
                    }

                    yield await queue.dequeue();
                }
            }
            finally {
                if (cp)
                    cp.kill();
            }
        }

        (async () => {
            try {
                for await (const message of input) {
                    if (!message)
                        continue;

                    if (Buffer.isBuffer(message)) {
                        if (cp)
                            cp.write(message.toString());
                        continue;
                    }

                    try {
                        const parsed = JSON.parse(message.toString());
                        if (parsed.dim) {
                            if (cp)
                                cp.resize(parsed.dim.cols, parsed.dim.rows);
                        } else if (parsed.eof) {
                            if (cp)
                                cp.sendEOF();
                        } else if ("interactive" in parsed && !cp) {
                            if (parsed.interactive) {
                                cp = new InteractiveTerminal();
                            } else {
                                cp = new NoninteractiveTerminal();
                            }
                            registerChildListeners();
                        }
                    } catch {
                        if (cp)
                            cp.write(message.toString());
                    }
                }
            }
            catch (e) {
                this.console.log(e);
                if (cp)
                    cp.kill();
            }
        })();

        return generator();
    }
}