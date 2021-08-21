import { Readable } from "stream";

export async function readLength(readable: Readable, length: number): Promise<Buffer> {
    if (!length) {
        return Buffer.alloc(0);
    }

    {
        const ret = readable.read(length);
        if (ret) {
            return ret;
        }
    }

    return new Promise((resolve, reject) => {
        const r = () => {
            const ret = readable.read(length);
            if (ret) {
                cleanup();
                resolve(ret);
            }
        };

        const e = () => {
            cleanup();
            reject(new Error(`stream ended during read for minimum ${length} bytes`))
        };

        const cleanup = () => {
            readable.removeListener('readable', r);
            readable.removeListener('end', e);
        }

        readable.on('readable', r);
        readable.on('end', e);
    });
}
