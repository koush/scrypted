import { RtpPacket } from "../../../../../external/werift/packages/rtp/src/rtp/rtp";

// https://datatracker.ietf.org/doc/html/rfc6716

// INPUT

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

export class OpusRepacketizer {
    packets: RtpPacket[] = [];

    constructor(public framesPerPacket: number) {
    }

    // repacketize a packet with a single frame into a packet with multiple frames.
    repacketize(packet: RtpPacket): RtpPacket|undefined {
        if (this.framesPerPacket === 1)
            return packet;

        if (packet.payload[0] & 0b00000011)
            throw new Error('expected opus packet with a single frame.');
        this.packets.push(packet);

        if (this.packets.length != this.framesPerPacket)
            return;

        const first = this.packets[0];
        const depacketized = this.packets.map(packet => packet.payload.subarray(1));
        this.packets = [];

        let config = first.payload[0];
        config = config | 0b00000011;
        let frameCount = 0b10000000 | this.framesPerPacket;

        const newHeader: number[] = [config, frameCount];
        // depacketize by stripping off the config byte

        // M-1 length bytes
        newHeader.push(...depacketized.slice(0, -1).map(data => data.length));

        const headerBuffer = Buffer.from(newHeader);
        const payload = Buffer.concat([headerBuffer, ...depacketized]);

        packet.payload = payload;
        return packet;
    }
}
