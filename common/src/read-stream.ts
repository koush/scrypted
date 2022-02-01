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

const CHARCODE_NEWLINE = '\n'.charCodeAt(0);

export async function readUntil(readable: Readable, charCode: number) {
  const data = [];
  let count = 0;
  while (true) {
    const buffer = await readLength(readable, 1);
    if (!buffer)
      throw new Error("end of stream");
    if (buffer[0] === charCode)
      break;
    data[count++] = buffer[0];
  }
  return Buffer.from(data).toString();
}

export async function readLine(readable: Readable) {
  return readUntil(readable, CHARCODE_NEWLINE);
}
