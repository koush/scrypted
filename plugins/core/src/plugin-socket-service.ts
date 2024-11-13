import { createAsyncQueue } from '@scrypted/common/src/async-queue';
import sdk, { ScryptedDeviceBase, ScryptedNativeId, StreamService } from "@scrypted/sdk";
import { once } from 'events';
import net from 'net';

export const ReplServiceNativeId = 'replservice';
export const ConsoleServiceNativeId = 'consoleservice';

export class PluginSocketService extends ScryptedDeviceBase implements StreamService<Buffer|string, Buffer> {
    constructor(nativeId: ScryptedNativeId, public serviceName: string) {
        super(nativeId);
    }

    async connectStream(input?: AsyncGenerator<Buffer | string, void>, options?: any): Promise<AsyncGenerator<Buffer, void>> {
        const pluginId = options?.pluginId as string;
        if (!pluginId)
            throw new Error('must provide pluginId');

        const plugins = await sdk.systemManager.getComponent('plugins');
        const servicePort = await plugins.getRemoteServicePort(pluginId, this.serviceName) as number | [number, string];
        const [port, host] = Array.isArray(servicePort) ? servicePort : [servicePort, undefined];

        const socket = net.connect({
            port,
            host,
        });
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
            catch (e) {
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