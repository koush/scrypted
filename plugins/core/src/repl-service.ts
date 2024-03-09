import { createAsyncQueue } from '@scrypted/common/src/async-queue';
import sdk, { ScryptedDeviceBase, ScryptedNativeId, StreamService } from "@scrypted/sdk";
import { once } from 'events';
import net from 'net';

export const ReplServiceNativeId = 'replservice';

export class ReplService extends ScryptedDeviceBase implements StreamService {
    constructor(nativeId?: ScryptedNativeId) {
        super(ReplServiceNativeId);
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
    async connectStream(input?: AsyncGenerator<Buffer | string, void>, options?: any): Promise<AsyncGenerator<Buffer, void>> {
        const pluginId = options?.pluginId as string;
        if (!pluginId)
            throw new Error('must provide pluginId');

        const plugins = await sdk.systemManager.getComponent('plugins');
        const replPort: number = await plugins.getRemoteServicePort(pluginId, 'repl');

        const socket = net.connect(replPort);
        await once(socket, 'connect');

        const queue = createAsyncQueue<Buffer>();
        socket.on('close', () => queue.end());
        socket.on('end', () => queue.end());

        let bufferedLength = 0;
        const MAX_BUFFERED_LENGTH = 64000;
        socket.on('data', async data => {
            const buffer = Buffer.from(data);
            bufferedLength += buffer.length;
            const promise = queue.enqueue(buffer).then(() => bufferedLength -= buffer.length);
            if (bufferedLength >= MAX_BUFFERED_LENGTH) {
                socket.pause();
                await promise;
                if (bufferedLength < MAX_BUFFERED_LENGTH)
                    socket.resume();
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
                socket.destroy();
            }
        }

        (async () => {
            try {
                for await (const message of input) {
                    if (!message)
                        continue;

                    if (!Buffer.isBuffer(message)) 
                        throw new Error("unexpected control message");

                    socket.write(message);
                }
            }
            catch (e) {
                this.console.log(e);
            }
            socket.destroy();
        })();

        return generator();
    }
}