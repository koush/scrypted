import { ScryptedDeviceBase, StreamService } from "@scrypted/sdk";
import type { IPty, spawn as ptySpawn } from 'node-pty-prebuilt-multiarch';
import { createAsyncQueue } from '@scrypted/common/src/async-queue'

export const TerminalServiceNativeId = 'terminalservice';

export class TerminalService extends ScryptedDeviceBase implements StreamService {
    async connectStream(input: AsyncGenerator<any, void>): Promise<AsyncGenerator<any, void>> {
        const spawn = require('node-pty-prebuilt-multiarch').spawn as typeof ptySpawn;
        const cp: IPty = spawn(process.env.SHELL as string, [], {});
        const queue = createAsyncQueue<Buffer>();
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
                cp.kill();
            }
        }

        (async () => {
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
            }
            catch (e) {
                this.console.log(e);
            }
            finally {
                cp.kill();
            }
        })();

        return generator();
    }
}