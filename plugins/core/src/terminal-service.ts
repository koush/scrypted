import sdk, { ClusterForkInterface, ClusterForkInterfaceOptions, ScryptedDeviceBase, ScryptedInterface, ScryptedNativeId, StreamService, TTYSettings } from "@scrypted/sdk";
import type { IPty, spawn as ptySpawn } from 'node-pty';
import { createAsyncQueue } from '@scrypted/common/src/async-queue'
import { ChildProcess, spawn as childSpawn } from "child_process";
import path from 'path';

export const TerminalServiceNativeId = 'terminalservice';

const { systemManager } = sdk;

function toSpawnPathEnv(paths: string[]): string {
    const existingPath = process.env.PATH;
    const extraPaths = paths.join(path.delimiter);
    if (existingPath && extraPaths)
        return `${extraPaths}${path.delimiter}${existingPath}`;
    return extraPaths || existingPath;
}

class InteractiveTerminal {
    cp: IPty

    constructor(cmd: string[], paths: string[], spawn: typeof ptySpawn) {
        const spawnPath = toSpawnPathEnv(paths);
        if (cmd?.length) {
            this.cp = spawn(cmd[0], cmd.slice(1), { env: { ...process.env, PATH: spawnPath } });
        } else {
            this.cp = spawn(process.env.SHELL as string, [], { env: { ...process.env, PATH: spawnPath } });
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

    constructor(cmd: string[], paths: string[]) {
        const spawnPath = toSpawnPathEnv(paths);
        if (cmd?.length) {
            this.cp = childSpawn(cmd[0], cmd.slice(1), { env: { ...process.env, PATH: spawnPath } });
        } else {
            this.cp = childSpawn(process.env.SHELL as string, { env: { ...process.env, PATH: spawnPath } });
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


export class TerminalService extends ScryptedDeviceBase implements StreamService<Buffer | string, Buffer>, ClusterForkInterface {
    private forks: { [clusterWorkerId: string]: TerminalService } = {};
    private forkClients: 0;

    constructor(nativeId?: ScryptedNativeId, private isFork: boolean = false) {
        super(nativeId);
    }

    async getExtraPaths(): Promise<string[]> {
        let extraPaths: string[] = [];
        const state = systemManager.getSystemState();
        for (const id in state) {
            const device = systemManager.getDeviceById<TTYSettings>(id);
            if (device.interfaces.includes(ScryptedInterface.TTYSettings)) {
                try {
                    const ttySettings = await device.getTTYSettings();
                    extraPaths = extraPaths.concat(ttySettings.paths || []);
                }
                catch (e) {
                    this.console.log(e);
                }
            }
        }
        return extraPaths;
    }

    async forkInterface<StreamService>(forkInterface: ScryptedInterface, options?: ClusterForkInterfaceOptions): Promise<StreamService> {
        if (forkInterface !== ScryptedInterface.StreamService) {
            throw new Error('can only fork StreamService');
        }

        if (!options?.clusterWorkerId) {
            throw new Error('clusterWorkerId required');
        }

        if (this.isFork) {
            throw new Error('cannot fork a fork');
        }

        const clusterWorkerId = options.clusterWorkerId;
        if (this.forks[clusterWorkerId]) {
            return this.forks[clusterWorkerId] as StreamService;
        }

        const fork = sdk.fork<{
            newTerminalService: typeof newTerminalService,
        }>({ clusterWorkerId });
        try {
            const result = await fork.result;
            const terminalService = await result.newTerminalService();
            this.forks[clusterWorkerId] = terminalService;
            fork.worker.on('exit', () => {
                delete this.forks[clusterWorkerId];
            });
            return terminalService as StreamService;
        }
        catch (e) {
            fork.worker.terminate();
            throw e;
        }
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
        const extraPaths = await this.getExtraPaths();

        if (this.isFork) {
            this.forkClients++;
        }

        queue.endPromise.then(() => {
            if (this.isFork) {
                this.forkClients--;
                if (this.forkClients === 0) {
                    process.exit();
                }
            }
        });

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
                                    spawn = require('@scrypted/node-pty').spawn as typeof ptySpawn;
                                    cp = new InteractiveTerminal(cmd, extraPaths, spawn);
                                }
                                catch (e) {
                                    this.console.error('Error starting pty', e);
                                    queue.end(e);
                                    return;
                                }
                            } else {
                                cp = new NoninteractiveTerminal(cmd, extraPaths);
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
            }
            finally {
                cp?.kill();
            }
        })();

        return generator();
    }
}

export async function newTerminalService(): Promise<TerminalService> {
    return new TerminalService(TerminalServiceNativeId, true);
}