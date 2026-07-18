import type { RtpPacket } from "@koush/werift-src/packages/rtp/src/rtp/rtp";

// https://datatracker.ietf.org/doc/html/rfc6716

// INPUT (for single frame sample, see RFC for other 4 code values)

// 0                   1                   2                   3
// 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
// +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
// | config  |s|0|0|                                               |
// +-+-+-+-+-+-+-+-+                                               |
// |                    Compressed frame 1 (N-1 bytes)...          :
// :                                                               |
// |                                                               |
// +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+


// OUTPUT

// 0                   1                   2                   3
// 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
// +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
// | config  |s|1|1|1|p|     M     | Padding length (Optional)     :
// +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
// : N1 (1-2 bytes): N2 (1-2 bytes):     ...       :     N[M-1]    |
// +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
// |                                                               |
// :               Compressed frame 1 (N1 bytes)...                :
// |                                                               |
// +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
// |                                                               |
// :               Compressed frame 2 (N2 bytes)...                :
// |                                                               |
// +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
// |                                                               |
// :                              ...                              :
// |                                                               |
// +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
// |                                                               |
// :                     Compressed frame M...                     :
// |                                                               |
// +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
// :                  Opus Padding (Optional)...                   |
// +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+


//                  Figure 6: A CBR Code 3 Packet

// In the VBR case, the (optional) padding length is followed by M-1
// frame lengths (indicated by "N1" to "N[M-1]" in Figure 7), each
// encoded in a one- or two-byte sequence as described above.  The
// packet MUST contain enough data for the M-1 lengths after removing
// the (optional) padding, and the sum of these lengths MUST be no
// larger than the number of bytes remaining in the packet after
// decoding them [R7].  The compressed data for all M frames follows,
// each frame consisting of the indicated number of bytes, with the
// final frame consuming any remaining bytes before the final padding,
// as illustrated in Figure 6.  The number of header bytes (TOC byte,
// frame count byte, padding length bytes, and frame length bytes), plus
// the signaled length of the first M-1 frames themselves, plus the
// signaled length of the padding MUST be no larger than N, the total
// size of the packet.

// The Opus frame duration (ms) is encoded in the config (top 5 bits of the TOC byte), per RFC 6716 3.1.
export function getOpusFrameDuration(toc: number): number {
    const config = toc >> 3;
    if (config < 12)
        return [10, 20, 40, 60][config & 0b11]; // SILK
    if (config < 16)
        return [10, 20][config & 0b01];          // Hybrid
    return [2.5, 5, 10, 20][config & 0b11];       // CELT
}

// Encode an opus frame length as 1 or 2 bytes, per RFC 6716 3.2.1: lengths < 252 use a single byte;
// larger lengths use two bytes where total = b0 + b1 * 4 with 252 <= b0 <= 255.
function encodeFrameLength(length: number): number[] {
    if (length < 252)
        return [length];
    const b1 = Math.floor((length - 252) / 4);
    const b0 = length - b1 * 4;
    return [b0, b1];
}

export class OpusRepacketizer {
    depacketized: Buffer[] = [];
    extraPackets = 0;

    // framesPerPacket and frameDuration are derived from the TOC of each incoming packet: the
    // HAP-requested packet time divided by the actual opus frame duration. This replaces the old
    // assumption that frames are always 20ms, which corrupted timestamps for e.g. 60ms SILK.
    framesPerPacket: number;
    frameDuration: number;

    // packetTime is the packet duration (ms) HAP requested (e.g. 20 on LAN, 60 over LTE).
    constructor(public packetTime: number) {
    }

    // actual duration (ms) of each emitted packet: framesPerPacket frames of frameDuration each.
    get emittedPacketTime() {
        return this.frameDuration * this.framesPerPacket;
    }

    // repacketize a packet with a single frame into a packet with multiple frames.
    repacketize(packet: RtpPacket): RtpPacket[] | undefined {
        const code = packet.payload[0] & 0b00000011;
        let offset: number;

        // derive frames-per-packet from the actual frame duration in the TOC. if the encoder switches
        // config mid-stream the frame duration changes: recompute and drop any partially accumulated
        // frames, which belong to the previous configuration.
        const frameDuration = getOpusFrameDuration(packet.payload[0]);
        if (frameDuration !== this.frameDuration) {
            this.frameDuration = frameDuration;
            // frames longer than the requested packet time can't be split without a re-encode, so they
            // pass through one per packet (hence Math.max(1, ...)).
            this.framesPerPacket = Math.max(1, Math.floor(this.packetTime / frameDuration));
            this.depacketized = [];
        }

        // see Frame Length Coding in RFC
        const decodeFrameLength = () => {
            let frameLength = packet.payload.readUInt8(offset++);
            if (frameLength >= 252) {
                // 2-byte length: total = b0 + b1 * 4 (RFC 6716 3.2.1). read the second byte and advance.
                frameLength += packet.payload.readUInt8(offset++) * 4;
            }
            return frameLength;
        }
        // code 0: cbr, 1 packet
        // code 1: cbr, 2 packets
        // code 2: vbr, 2 packets
        // code 3: cbr/vbr signaled, variable packets

        if (code === 0) {
            if (this.framesPerPacket === 1 && !this.depacketized.length)
                return [packet];
            // depacketize by stripping off the config byte
            this.depacketized.push(packet.payload.subarray(1));
        }
        else if (code === 1) {
            if (this.framesPerPacket === 2 && !this.depacketized.length)
                return [packet];
            // depacketize by dividing the remaining payload into two equal sized frames
            const remaining = packet.payload.length - 1;
            if (remaining % 2)
                throw new Error('expected equal sized opus packets (code 1)');
            const frameLength = remaining / 2;
            this.depacketized.push(packet.payload.subarray(1, 1 + frameLength));
            this.depacketized.push(packet.payload.subarray(1 + frameLength));
        }
        else if (code === 2) {
            if (this.framesPerPacket === 2 && !this.depacketized.length)
                return [packet];
            offset = 1;
            // depacketize by dividing the remaining payload into two inequal sized frames
            const frameLength = decodeFrameLength();
            this.depacketized.push(packet.payload.subarray(offset, offset + frameLength));
            this.depacketized.push(packet.payload.subarray(offset + frameLength));
        }
        else if (code === 3) {
            // code 3 packet will have a frame count and padding indicator, and whether the packets
            // are equal size or not.
            const frameCountByte = packet.payload[1];
            const packetFrameCount = frameCountByte & 0b00111111;
            const vbr = frameCountByte & 0b10000000;
            if (this.framesPerPacket === packetFrameCount && !this.depacketized.length)
                return [packet];
            const paddingIndicator = frameCountByte & 0b01000000;
            offset = 2;
            let padding = 0;
            if (paddingIndicator) {
                padding = packet.payload.readUInt8(offset);
                offset++;
                if (padding === 255) {
                    padding = 254 + packet.payload.readUInt8(offset);
                    offset++;
                }
            }

            if (!vbr) {
                const remaining = packet.payload.length - offset - padding;
                if (remaining % packetFrameCount)
                    throw new Error('expected equal sized opus packets (code 3)');
                const frameLength = remaining / packetFrameCount;
                for (let i = 0; i < packetFrameCount; i++) {
                    const start = offset + i * frameLength;
                    const end = start + frameLength;
                    this.depacketized.push(packet.payload.subarray(start, end));
                }
            }
            else {
                const frameLengths: number[] = [];
                for (let i = 0; i < packetFrameCount - 1; i++) {
                    const frameLength = decodeFrameLength();
                    frameLengths.push(frameLength);
                }
                for (let i = 0; i < frameLengths.length; i++) {
                    const frameLength = frameLengths[i];
                    const start = offset;
                    offset += frameLength;
                    this.depacketized.push(packet.payload.subarray(start, offset));
                }
                const lastFrameLength = (packet.payload.length - padding) - offset;
                this.depacketized.push(packet.payload.subarray(offset, offset + lastFrameLength));
            }
        }

        if (this.depacketized.length < this.framesPerPacket)
            return [];

        const ret: RtpPacket[] = [];
        while (true) {
            if (this.depacketized.length < this.framesPerPacket)
                return ret;

            const depacketized = this.depacketized.slice(0, this.framesPerPacket);
            this.depacketized = this.depacketized.slice(this.framesPerPacket);

            // reuse the config and stereo indicator, but change the code to 3.
            let toc = packet.payload[0];
            toc = toc | 0b00000011;  
            // vbr | padding indicator | packet count
            let frameCountByte = 0b10000000 | this.framesPerPacket;

            const newHeader: number[] = [toc, frameCountByte];

            // M-1 frame lengths, each 1 or 2 bytes (frames >= 252 bytes need the 2-byte encoding).
            for (const data of depacketized.slice(0, -1))
                newHeader.push(...encodeFrameLength(data.length));

            const headerBuffer = Buffer.from(newHeader);
            const payload = Buffer.concat([headerBuffer, ...depacketized]);

            const newPacket = packet.clone();
            if (ret.length)
                this.extraPackets++;
            newPacket.header.sequenceNumber = (packet.header.sequenceNumber + this.extraPackets + 0x10000) % 0x10000;
            newPacket.payload = payload;
            ret.push(newPacket);
        }
    }
}
