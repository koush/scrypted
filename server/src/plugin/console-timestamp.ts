import { Transform, TransformCallback } from 'stream';

// Prefix lines as they arrive, without waiting for a newline or decoding chunks
// that may split a UTF-8 character. Timestamps describe console receipt time.
export class ConsoleTimestampTransform extends Transform {
    private lineStart = true;

    override _transform(data: Buffer, encoding: BufferEncoding, callback: TransformCallback) {
        const output: Buffer[] = [];
        let offset = 0;
        while (offset < data.length) {
            if (this.lineStart)
                output.push(Buffer.from(`[${new Date().toISOString()}] `));

            const newline = data.indexOf(10, offset);
            const end = newline === -1 ? data.length : newline + 1;
            output.push(data.subarray(offset, end));
            this.lineStart = newline !== -1;
            offset = end;
        }
        callback(null, Buffer.concat(output));
    }
}
