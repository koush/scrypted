import { ScryptedDeviceBase, ScryptedNativeId, StreamService } from "@scrypted/sdk";
import type { IPty, spawn as ptySpawn } from 'node-pty-prebuilt-multiarch';
import { createAsyncQueue } from '@scrypted/common/src/async-queue'
import { ChildProcess, spawn as childSpawn } from "child_process";

export const TerminalServiceNativeId = 'terminalservice';


class InteractiveTerminal {
    cp: IPty

    constructor(cmd: string[], spawn: typeof ptySpawn) {
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


export class TerminalService extends ScryptedDeviceBase implements StreamService<Buffer | string, Buffer> {
    constructor(nativeId?: ScryptedNativeId) {
        super(TerminalServiceNativeId);
    }

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
    async connectStream(input: AsyncGenerator<Buffer | string, void>, options?: any): Promise<AsyncGenerator<Buffer, void>> {
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
                cp?.kill();
            }
        }

        (async () => {
            try {
                for await (const message of input) {
                    if (!message)
                        continue;

                    if (Buffer.isBuffer(message)) {
                        cp?.write(message);
                        continue;
                    }

                    try {
                        const parsed = JSON.parse(message.toString());
                        if (parsed.dim) {
                            cp?.resize(parsed.dim.cols, parsed.dim.rows);
                        } else if (parsed.eof) {
                            cp?.sendEOF();
                        } else if ("interactive" in parsed && !cp) {
                            const cmd = parsed.cmd || options?.cmd;
                            if (parsed.interactive) {
                                let spawn: typeof ptySpawn;
                                try {
                                    try {
                                        spawn = require('node-pty-prebuilt-multiarch').spawn as typeof ptySpawn;
                                        if (!spawn)
                                            throw new Error();
                                    }
                                    catch (e) {
                                        spawn = require('@scrypted/node-pty').spawn as typeof ptySpawn;
                                    }
                                    cp = new InteractiveTerminal(cmd, spawn);
                                }
                                catch (e) {
                                    this.console.error('Error starting pty', e);
                                    queue.end(e);
                                    return;
                                }
                            } else {
                                cp = new NoninteractiveTerminal(cmd);
                            }
                            registerChildListeners();
                        }
                    } catch {
                        cp?.write(Buffer.from(message));
                    }
                }
            }
            catch (e) {
                this.console.log(e);
                cp?.kill();
            }
        })();

        return generator();
    }
}