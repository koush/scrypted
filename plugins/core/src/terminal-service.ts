import { ScryptedDeviceBase, StreamService } from "@scrypted/sdk";
import type { IPty, spawn as ptySpawn } from 'node-pty-prebuilt-multiarch';
import { BufferedBuffer } from '@scrypted/common/src/buffered-buffer';

export const TerminalServiceNativeId = 'terminalservice';

export class TerminalService extends ScryptedDeviceBase implements StreamService {
    async connectStream(input: AsyncGenerator<any, void>): Promise<AsyncGenerator<any, void>> {
        const spawn = require('node-pty-prebuilt-multiarch').spawn as typeof ptySpawn;
        const cp: IPty = spawn(process.env.SHELL, [], {});
        const buffer = new BufferedBuffer();
        buffer.onClose(() => cp.kill());

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
