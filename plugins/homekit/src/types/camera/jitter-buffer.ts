/**
 * This is a subset of Werift's RtpPacket.
 */
export interface RtpPacket {
    payload: Buffer;
    header: {
        padding: boolean;
        marker: boolean;
        timestamp: number;
        sequenceNumber: number;
    };
    clone(): RtpPacket;
    serialize(): Buffer;
}

export function sequenceNumberDistance(s1: number, s2: number): number {
    if (s2 === s1)
        return 0;
    const distance = s2 - s1;
    let rolloverDistance: number;
    if (s2 > s1)
        rolloverDistance = s1 + 0x10000 - s2;
    else
        rolloverDistance = s2 + 0x10000 - s1;

    if (Math.abs(distance) < Math.abs(rolloverDistance))
        return distance;
    return rolloverDistance;
}

export function nextSequenceNumber(current: number, increment = 1) {
    return (current + increment + 0x10000) % 0x10000;
}

const maxRtpTimestamp = BigInt(0xFFFFFFFF);
export function addRtpTimestamp(current: number, adjust: number) {
    return Number(maxRtpTimestamp & (BigInt(current) + BigInt(adjust)));
}

export function isNextSequenceNumber(current: number, next: number) {
    return nextSequenceNumber(current) === next;
}

export class JitterBuffer {
    lastSequenceNumber: number;
    pending: RtpPacket[] = [];

    constructor(public console: Console, public jitterSize: number,) {
    }

    flushPending(afterSequenceNumber: number, ret: RtpPacket[]): RtpPacket[] {
        if (!this.pending)
            return ret;

        const start = nextSequenceNumber(afterSequenceNumber);

        for (let i = 0; i < this.jitterSize; i++) {
            const index = (start + i) % this.jitterSize;
            const packet = this.pending[index];
            if (!packet)
                continue;
            const { sequenceNumber } = packet.header;
            const sd = sequenceNumberDistance(this.lastSequenceNumber, sequenceNumber);
            // packet needs to be purged from the the buffer for being too old.
            if (sd <= 0) {
                this.console.log('jitter buffer purged packet:', sequenceNumber);
                this.pending[index] = undefined;
                ret.push(packet);
            }
            else if (sd === 1) {
                this.pending[index] = undefined;
                this.lastSequenceNumber = sequenceNumber;
                ret.push(packet);
            }
            else {
                // can't do anything with this packet yet.
            }
        }
        return ret;
    }

    queue(packet: RtpPacket): RtpPacket[] {
        if (this.lastSequenceNumber === undefined || isNextSequenceNumber(this.lastSequenceNumber, packet.header.sequenceNumber)) {
            this.lastSequenceNumber = packet.header.sequenceNumber;
            return this.flushPending(this.lastSequenceNumber, [packet]);
        }

        const { sequenceNumber } = packet.header;
        const packetDistance = sequenceNumberDistance(this.lastSequenceNumber, sequenceNumber);
        // late/duplicate packet
        if (packetDistance <= 0)
            return [];

        const ret: RtpPacket[] = [];

        // missed/late bunch of packets
        if (packetDistance > this.jitterSize) {
            // this.console.log('jitter buffer skipped packets:', packetDistance);
            const { lastSequenceNumber } = this;
            this.lastSequenceNumber = sequenceNumber - this.jitterSize;
            // use the previous sequence number to flush any packets that are too old compared
            // to the new sequence number.
            this.flushPending(lastSequenceNumber, ret);
        }

        this.pending[packet.header.sequenceNumber % this.jitterSize] = packet;
        return this.flushPending(this.lastSequenceNumber, ret);
    }
}
