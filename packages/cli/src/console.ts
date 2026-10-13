import { DeviceProvider, ScryptedStatic, StreamService } from "@scrypted/types";
import { createAsyncQueue } from '../../../common/src/async-queue';
import { sleep } from '../../../common/src/sleep';

export async function connectConsole(sdk: ScryptedStatic, timeoutSeconds: number, idOrName: string) {
    const consoleSvc = await sdk.systemManager.getDeviceByName<DeviceProvider>("@scrypted/core").getDevice("consoleservice");
    if (!consoleSvc) {
        throw Error("@scrypted/core does not provide a Console Service");
    }

    const consoleSvcDirect = await sdk.connectRPCObject<StreamService<Buffer | string, Buffer>>(consoleSvc);

    const device: any = sdk.systemManager.getDeviceById(idOrName) || sdk.systemManager.getDeviceByName(idOrName);
    const pluginId: string = device?.pluginId || idOrName;
    const nativeId: string = device?.nativeId || 'undefined';

    let timedOut = false;
    let endStream: (() => void) | undefined;
    const timer = timeoutSeconds > 0 ? setTimeout(() => {
        timedOut = true;
        endStream?.();
    }, timeoutSeconds * 1000) : undefined;

    try {
        while (true) {
            if (timedOut)
                break;

            // the first buffer written into the stream is the nativeId filter
            // used by the console service to select the plugin or device console.
            const dataQueue = createAsyncQueue<Buffer | string>();
            dataQueue.submit(Buffer.from(nativeId));

            let ended = false;
            endStream = () => {
                if (!ended) {
                    ended = true;
                    dataQueue.end();
                }
            };

            const remoteGenerator = await consoleSvcDirect.connectStream(dataQueue.queue, { pluginId });

            try {
                for await (const message of remoteGenerator) {
                    if (!message) {
                        break;
                    }
                    process.stdout.write(new Uint8Array(Buffer.from(message)));
                }
            }
            finally {
                endStream = undefined;
            }

            if (timedOut)
                break;

            // the stream ends when the plugin restarts. reconnect.
            await sleep(1000);
        }
    }
    finally {
        clearTimeout(timer);
    }
}