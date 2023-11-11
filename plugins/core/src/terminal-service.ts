import { ScryptedDeviceBase, StreamService } from "@scrypted/sdk";
import type { IPty, spawn as ptySpawn } from 'node-pty-prebuilt-multiarch';

export const TerminalServiceNativeId = 'terminalservice';

class BufferedBuffer {
    _buf: Buffer
    _closed: boolean
    _resolve: Function

    constructor() {
        this._buf = Buffer.alloc(0);
    }

    mayResolve() {
        if (this._closed && this._resolve) {
            this._resolve(null);
            this._resolve = null;
            return;
        }
        if (!this._resolve || this._buf.length == 0) {
            return;
        }
        const b = this._buf;
        this._buf = Buffer.alloc(0);
        this._resolve(b);
        this._resolve = null;
    }

    append(data: Buffer) {
        this._buf = Buffer.concat([this._buf, data]);
        this.mayResolve();
    }

    close() {
        this._closed = true;
        this.mayResolve();
    }

    getOrWait(): Promise<Buffer> {
        return new Promise(resolve => {
            this._resolve = resolve;
            this.mayResolve();
        });
    }

    async *generator(): AsyncGenerator<Buffer, void> {
        while (!this._closed) {
            yield this.getOrWait();
        }
    }
}

export class TerminalService extends ScryptedDeviceBase implements StreamService {
    async connectStream(input: AsyncGenerator<any, void>): Promise<AsyncGenerator<any, void>> {
        const spawn = require('node-pty-prebuilt-multiarch').spawn as typeof ptySpawn;
        const cp: IPty = spawn(process.env.SHELL, [], {});
        const buffer = new BufferedBuffer();

        cp.onData(data => buffer.append(Buffer.from(data)));
        cp.onExit(() => buffer.close());
        setTimeout(async () => {
            try {
                for await (const message of input) {
                    if (!message) {
                        cp.kill();
                        return;
                    }
                    if (Buffer.isBuffer(message)) {
                        cp.write(message.toString());
                        continue;
                    }
                    try {
                        const parsed = JSON.parse(message.toString());
                        if (parsed.dim) {
                            cp.resize(parsed.dim.cols, parsed.dim.rows);
                        }
                    } catch {
                        cp.write(message.toString());
                    }
                }
            } catch {
                cp.kill();
            }
        }, 0);

        return buffer.generator();
    }
}
