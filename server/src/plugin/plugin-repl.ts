import { ScryptedStatic } from '@scrypted/types';
import repl from 'repl';
import { PassThrough } from 'stream';
import { createAsyncQueue } from '../async-queue';

function toBuffer(value: any): Buffer {
    return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

export function createREPLStreamService(scrypted: ScryptedStatic, params: any, plugin: any): (input: AsyncGenerator<Buffer>) => Promise<AsyncGenerator<Buffer>> {
    return async (input) => {
        const iterator = input[Symbol.asyncIterator]();
        const first = await iterator.next();
        if (first.done)
            return (async function* () { })();

        const firstBuffer = toBuffer(first.value);
        let filterText: string;
        let remaining: Buffer | undefined;

        const newline = firstBuffer.indexOf(0x0a);
        if (newline !== -1) {
            remaining = firstBuffer.subarray(newline + 1);
            filterText = firstBuffer.subarray(0, newline).toString();
        }
        else {
            filterText = firstBuffer.toString();
        }

        filterText = filterText.trim();
        let filter: string | undefined = !filterText || filterText === 'undefined' ? undefined : filterText;

        const { deviceManager, systemManager } = scrypted;
        const chain: string[] = [];
        const nativeIds: Map<string, any> = (deviceManager as any).nativeIds;
        const reversed = new Map<string, string>();
        for (const nativeId of nativeIds.keys()) {
            reversed.set(nativeIds.get(nativeId).id, nativeId);
        }

        while (filter) {
            const entry = nativeIds.get(filter);
            if (!entry)
                break;
            const d = await systemManager.getDeviceById(entry.id);
            chain.push(filter);
            if (!d?.providerId)
                break;
            filter = reversed.get(d.providerId);
        }

        chain.reverse();
        let device = plugin;
        for (const c of chain) {
            device = await device.getDevice(c);
        }

        const realDevice = systemManager.getDeviceById(device.id);

        const ctx = Object.assign(params, {
            device,
            realDevice,
            sdk: scrypted,
        });
        delete ctx.console;
        delete ctx.window;
        delete ctx.WebSocket;
        delete ctx.pluginHostAPI;
        delete ctx.log;
        delete ctx.pluginRuntimeAPI;

        const replFilter = new Set<string>(['require', 'localStorage', 'exports', '__filename', 'log'])
        const replVariables = Object.keys(ctx).filter(key => !replFilter.has(key));

        const welcome = `JavaScript REPL variables:\n${replVariables.map(key => '  ' + key).join('\n')}\n\n`;

        const inputStream = new PassThrough();
        (async () => {
            try {
                if (remaining?.length)
                    inputStream.write(remaining);
                for await (const data of iterator) {
                    if (inputStream.destroyed)
                        return;
                    inputStream.write(toBuffer(data));
                }
            }
            catch (e) {
            }
            finally {
                inputStream.end();
            }
        })();

        const outputStream = new PassThrough();
        const outputQueue = createAsyncQueue<Buffer>();
        outputStream.on('data', data => outputQueue.submit(toBuffer(data)));
        outputStream.on('end', () => outputQueue.end());
        outputStream.on('close', () => outputQueue.end());
        outputStream.on('error', e => outputQueue.end(e as Error));

        outputStream.write(welcome);

        const replServer = repl.start({
            terminal: true,
            input: inputStream,
            output: outputStream,
            preview: false,
        });

        Object.assign(replServer.context, ctx);

        let cleaned = false;
        const cleanup = () => {
            if (cleaned)
                return;
            cleaned = true;
            replServer.close();
            inputStream.destroy();
            outputStream.end();
            iterator.return?.(undefined).catch(() => { });
        };

        replServer.on('exit', cleanup);
        inputStream.on('end', cleanup);
        inputStream.on('error', e => {
            outputQueue.end(e);
            cleanup();
        });

        return (async function* () {
            try {
                while (true) {
                    const buffers = outputQueue.clear();
                    if (buffers.length) {
                        yield Buffer.concat(buffers);
                        continue;
                    }

                    yield await outputQueue.dequeue();
                }
            }
            catch (e) {
            }
            finally {
                cleanup();
            }
        })();
    };
}
