import { depacketizeStapA, H264Repacketizer } from '../../homekit/src/types/camera/h264-packetizer';
import { isNextSequenceNumber, RtpPacket } from '../../homekit/src/types/camera/jitter-buffer';
import { depacketizeAP, H265Repacketizer } from './h265-packetizer';
import { SFrameStreamCryptor } from './sframe';

// Sender-lifetime state: both the counter and output sequence survive forwarder replacement.
export class SFrameRtpPacketizer {
    private sequenceNumber?: number;

    constructor(private readonly cryptor: SFrameStreamCryptor, private readonly maxPayload = 1150) {
        if (!Number.isInteger(maxPayload) || maxPayload < 2)
            throw new RangeError('SFrame payload budget must include descriptor and frame data');
    }

    packetize<T extends RtpPacket>(packet: T, plaintext: Buffer): T[] {
        const protectedFrame = this.cryptor.protectFrame(plaintext);
        this.sequenceNumber ??= packet.header.sequenceNumber;
        const ret: T[] = [];
        const chunkSize = this.maxPayload - 1;
        for (let offset = 0; offset < protectedFrame.length; offset += chunkSize) {
            const end = offset + chunkSize >= protectedFrame.length;
            const descriptor = (offset === 0 ? 0x80 : 0) | (end ? 0x40 : 0);
            const output = packet.clone() as T;
            output.header.padding = false;
            output.header.sequenceNumber = this.sequenceNumber;
            this.sequenceNumber = (this.sequenceNumber + 1) & 0xffff;
            output.header.marker = packet.header.marker && end;
            output.payload = Buffer.concat([Buffer.from([descriptor]), protectedFrame.subarray(offset, offset + chunkSize)]);
            ret.push(output);
        }
        return ret;
    }
}

export class SFrameRepacketizer {
    private timestamp?: number;
    private lastSequenceNumber?: number;
    private nals: Buffer[] = [];
    private frameBytes = 0;
    private damaged = false;
    private readonly h265: boolean;

    constructor(private readonly repacketizer: H264Repacketizer | H265Repacketizer,
        private readonly packetizer: SFrameRtpPacketizer) {
        this.h265 = repacketizer instanceof H265Repacketizer;
    }

    repacketize<T extends RtpPacket>(packet: T): T[] {
        const ret: T[] = [];
        for (const nalPacket of this.repacketizer.repacketize(packet)) {
            const { timestamp, sequenceNumber, marker } = nalPacket.header;
            if (timestamp !== this.timestamp) {
                this.reset();
                this.timestamp = timestamp;
            }
            if (this.lastSequenceNumber !== undefined && !isNextSequenceNumber(this.lastSequenceNumber, sequenceNumber))
                this.damaged = true;
            this.lastSequenceNumber = sequenceNumber;

            if (!this.damaged) {
                const nals = this.getNals(nalPacket.payload);
                if (!nals)
                    this.damaged = true;
                else {
                    for (const nal of nals) {
                        this.frameBytes += 4 + nal.length;
                        // Bound accumulation if a source never supplies a marker.
                        if (this.frameBytes > 16 * 1024 * 1024) {
                            this.damaged = true;
                            break;
                        }
                        const length = Buffer.alloc(4);
                        length.writeUInt32BE(nal.length);
                        this.nals.push(length, nal);
                    }
                }
            }
            if (this.damaged)
                this.nals = [];
            if (!marker)
                continue;
            if (!this.damaged && this.nals.length)
                ret.push(...this.packetizer.packetize(nalPacket, Buffer.concat(this.nals, this.frameBytes)));
            this.reset();
        }
        return ret;
    }

    private reset() {
        this.timestamp = undefined;
        this.nals = [];
        this.frameBytes = 0;
        this.damaged = false;
    }

    private getNals(payload: Buffer): Buffer[] | undefined {
        const headerSize = this.h265 ? 2 : 1;
        if (payload.length < headerSize)
            return;
        const type = this.h265 ? (payload[0] >> 1) & 0x3f : payload[0] & 0x1f;
        if (type !== (this.h265 ? 48 : 24)) {
            // Infinity reconstructs complete FUs. Residual FUs represent incomplete
            // data flushed by the wrapped repacketizer and invalidate this frame.
            if (this.h265 ? type >= 48 : type < 1 || type >= 24)
                return;
            return [payload];
        }
        // Validate lengths before using the existing aggregation helpers.
        let offset = headerSize;
        while (offset < payload.length) {
            if (offset + 2 > payload.length)
                return;
            const length = payload.readUInt16BE(offset);
            offset += 2;
            if (length < headerSize || offset + length > payload.length)
                return;
            offset += length;
        }
        if (offset === headerSize)
            return;
        return this.h265 ? depacketizeAP(payload) : depacketizeStapA(payload);
    }
}
