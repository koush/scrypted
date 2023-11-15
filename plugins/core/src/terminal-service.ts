import { ScryptedDeviceBase, StreamService } from "@scrypted/sdk";
import { IPty, spawn as ptySpawn } from 'node-pty-prebuilt-multiarch';
import { createAsyncQueue } from '@scrypted/common/src/async-queue'
import { ChildProcess, spawn as childSpawn } from "child_process";

export const TerminalServiceNativeId = 'terminalservice';


class InteractiveTerminal {
    cp: IPty

    constructor(cmd: string[]) {
        const spawn = require('node-pty-prebuilt-multiarch').spawn as typeof ptySpawn;
        if (cmd?.length) {
            this.cp = spawn(cmd[0], cmd.slice(1), {});
        } else {
            this.cp = spawn(process.env.SHELL as string, [], {});
        }
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

    write(data: Buffer) {
        this.cp.write(data.toString());
    }

    sendEOF() {
        // not supported
    }

    kill(signal?: string) {
        this.cp.kill(signal);
    }

    resize(columns: number, rows: number) {
        if (columns > 0 && rows > 0)
            this.cp.resize(columns, rows);
    }
}

class NoninteractiveTerminal {
    cp: ChildProcess

    constructor(cmd: string[]) {
        if (cmd?.length) {
            this.cp = childSpawn(cmd[0], cmd.slice(1));
        } else {
            this.cp = childSpawn(process.env.SHELL as string);
        }
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
        this.cp.stdout.resume();
        this.cp.stderr.resume();
    }

    write(data: Buffer) {
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
    /*
     * The input to this stream can send buffers for normal terminal data and strings
     * for control messages. Control messages are JSON-formatted.
     *
     * The current implemented control messages:
     *
     *   Start: { "interactive": boolean, "cmd": string[] }
     *   Resize: { "dim": { "cols": number, "rows": number } }
     *   EOF: { "eof": true }
     */
    async connectStream(input: AsyncGenerator<Buffer | string, void>): Promise<AsyncGenerator<Buffer, void>> {
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
                            cp.write(message);
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
                                cp = new InteractiveTerminal(parsed.cmd);
                            } else {
                                cp = new NoninteractiveTerminal(parsed.cmd);
                            }
                            registerChildListeners();
                        }
                    } catch {
                        if (cp)
                            cp.write(Buffer.from(message));
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