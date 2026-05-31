import { DeviceProvider, ScryptedStatic, StreamService } from "@scrypted/types";
import { createAsyncQueue } from '../../../common/src/async-queue';

export async function connectShell(sdk: ScryptedStatic, ...cmd: string[]) {
    const termSvc = await sdk.systemManager.getDeviceByName<DeviceProvider>("@scrypted/core").getDevice("terminalservice");
    if (!termSvc) {
        throw Error("@scrypted/core does not provide a Terminal Service");
    }

    const termSvcDirect = await sdk.connectRPCObject<StreamService<Buffer|string, Buffer>>(termSvc);
    const dataQueue = createAsyncQueue<Buffer>();
    const ctrlQueue = createAsyncQueue<any>();

    if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
    } else {
        process.stdin.on("end", () => {
            ctrlQueue.enqueue({ eof: true });
            dataQueue.enqueue(Buffer.alloc(0));
        });
    }
    ctrlQueue.enqueue({ interactive: Boolean(process.stdin.isTTY), cmd: cmd });

    const dim = { cols: process.stdout.columns, rows: process.stdout.rows };
    ctrlQueue.enqueue({ dim });

    let bufferedLength = 0;
    const MAX_BUFFERED_LENGTH = 64000;
    process.stdin.on('data', async data => {
        bufferedLength += data.length;
        const promise = dataQueue.enqueue(data).then(() => bufferedLength -= data.length);
        if (bufferedLength >= MAX_BUFFERED_LENGTH) {
            process.stdin.pause();
            await promise;
            if (bufferedLength < MAX_BUFFERED_LENGTH)
                process.stdin.resume();
        }
    });

    async function* generator() {
        while (true) {
            const ctrlBuffers = ctrlQueue.clear();
            if (ctrlBuffers.length) {
                for (const ctrl of ctrlBuffers) {
                    if (ctrl.eof) {
                        // flush the buffer before sending eof
                        const dataBuffers = dataQueue.clear();
                        const concat = Buffer.concat(dataBuffers);
                        if (concat.length) {
                            yield concat;
                        }
                    }
                    yield JSON.stringify(ctrl);
                }
                continue;
            }

            const dataBuffers = dataQueue.clear();
            if (dataBuffers.length === 0) {
                const buf = await dataQueue.dequeue();
                if (buf.length)
                    yield buf;
                continue;
            }

            const concat = Buffer.concat(dataBuffers);
            if (concat.length)
                yield concat;
        }
    }

    process.stdout.on('resize', () => {
        const dim = { cols: process.stdout.columns, rows: process.stdout.rows };
        ctrlQueue.enqueue({ dim });
        dataQueue.enqueue(Buffer.alloc(0));
    });

    try {
        for await (const message of await termSvcDirect.connectStream(generator())) {
            if (!message) {
                process.exit();
            }
            process.stdout.write(new Uint8Array(Buffer.from(message)));
        }
    } catch {
        // ignore
    } finally {
        process.exit();
    }
}