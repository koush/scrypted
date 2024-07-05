const maxPacketSize = 1 << 16;

export class DataChannelDebouncer {
    timeout: NodeJS.Timeout;
    pending: Buffer;
    maxWait = 10;

    constructor(public dc: { send: (buffer: Buffer) => void }, public kill: (e: Error) => void) {
    }

    send(data: Buffer) {
        // if this buffer would exceed the max packet size, flush now to ensure only large packets are flushed.
        if (this.pending?.length + data.length >= maxPacketSize)
            this.flush();

        if (!this.pending)
            this.pending = data;
        else
            this.pending = Buffer.concat([this.pending, data]);
        clearTimeout(this.timeout);
        this.timeout = setTimeout(() => this.flush(), this.maxWait);

        // if this buffer exceeds the max packet size, flush now to send the entire message immediately.
        if (this.pending?.length + data.length >= maxPacketSize)
            this.flush();
    }

    flush() {
        try {
            let offset = 0;
            while (offset < this.pending.length) {
                this.dc.send(this.pending.slice(offset, offset + maxPacketSize));
                offset += maxPacketSize;
            }
    
            this.pending = undefined;
            clearTimeout(this.timeout);
            this.timeout = undefined;
        }
        catch (e) {
            this.kill(e as Error);
        }
    }
}
