import { createAsyncQueue } from "./async-queue"

const MAX_BUFFERED_BUFFER = 100;

export class BufferedBuffer {
    queue: ReturnType<typeof createAsyncQueue<Buffer | string>>

    constructor() {
        this.queue = createAsyncQueue<Buffer | string>();
    }

    append(data: Buffer | string) {
        this.queue.submit(data);
    }

    close() {
        this.queue.end();
    }

    onClose(fn: Function) {
        this.queue.onEnd(fn);
    }

    /**
     * The returned AsyncGenerator will concatenate together
     * sequential Buffers, but leave strings unchanged.
     */
    async *generator(): AsyncGenerator<Buffer | string, void> {
        while (!this.queue.ended) {
            const first = await this.queue.dequeue();
            if (typeof(first) === "string") {
                yield first;
                continue;
            }

            let buf = first;
            let count = 1;
            while (true) {
                const next = this.queue.peek();
                if (!next || typeof(next) === "string") {
                    break;
                }
                buf = Buffer.concat([buf, this.queue.take() as Buffer]);
                count++;
            }

            if (count > MAX_BUFFERED_BUFFER) {
                this.close();
                throw new Error("exceeded buffer size");
            }

            yield buf;
        }
    }
}
