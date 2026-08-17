// Baichuan wire protocol: header layout, message class/id constants, and the
// Extension+payload body framing used by every request and reply.
//
// Reverse engineered from a live Reolink Video Doorbell PoE (2026 firmware)
// and cross-checked against the AlexxIT/go2rtc Baichuan implementation
// (pkg/baichuan/types.go), which independently confirms the same constants
// against a range of other Reolink models.

export const MAGIC_HEADER = 0x0abcdef0;

export const HeaderClass = {
    /** 20-byte header. Used for the very first, pre-login probe message. */
    Legacy: 0x6514,
    /** 20-byte header. Observed on some unsolicited replies from the device. */
    Modern: 0x6614,
    /** 24-byte header (adds a binOffset field). The class used for essentially
     * every authenticated request/reply once logged in. */
    ModernWithOffset: 0x6414,
    /** 24-byte header, alternate marker some replies use for the same modern
     * layout as ModernWithOffset. */
    ModernAlt: 0x0000,
} as const;

export function headerLenForClass(msgClass: number): number {
    return msgClass === HeaderClass.ModernWithOffset || msgClass === HeaderClass.ModernAlt ? 24 : 20;
}

/** Message ids used by this module. Names and values cross-checked against
 * go2rtc's pkg/baichuan/types.go; only the ids Phase 1 (two-way audio) needs
 * are exercised today, the rest are documented for future use (e.g. video). */
export const MsgId = {
    Login: 1,
    Logout: 2,
    Video: 3,
    VideoStop: 4,
    TalkAbility: 10,
    /** Not TalkConfig - see TalkConfig below. Also doubles as "stop talking". */
    TalkReset: 11,
    AbilityInfo: 151,
    /** NOT 11. Sending TalkConfig as msg id 11 gets silently misinterpreted
     * as a TalkReset with an unexpected body and rejected. */
    TalkConfig: 201,
    Talk: 202,
} as const;

export interface BcHeader {
    msgId: number;
    bodyLen: number;
    channelId: number;
    streamType: number;
    msgNum: number;
    responseCode: number;
    msgClass: number;
    /** Only present for the 24-byte header layout. */
    binOffset?: number;
}

export function packHeader(header: BcHeader): Buffer {
    const headerLen = headerLenForClass(header.msgClass);
    const buf = Buffer.alloc(headerLen);
    buf.writeUInt32LE(MAGIC_HEADER, 0);
    buf.writeUInt32LE(header.msgId, 4);
    buf.writeUInt32LE(header.bodyLen, 8);
    buf.writeUInt8(header.channelId, 12);
    buf.writeUInt8(header.streamType, 13);
    buf.writeUInt16LE(header.msgNum, 14);
    buf.writeUInt16LE(header.responseCode, 16);
    buf.writeUInt16LE(header.msgClass, 18);
    if (headerLen === 24)
        buf.writeUInt32LE(header.binOffset || 0, 20);
    return buf;
}

/**
 * Parses a header from `buf`, which must be at least 20 bytes. Callers
 * should peek the class at bytes [18:20) via `headerLenForClass` first to
 * know whether they need to read 20 or 24 bytes off the socket.
 */
export function parseHeader(buf: Buffer): BcHeader {
    const magic = buf.readUInt32LE(0);
    if (magic !== MAGIC_HEADER)
        throw new Error(`unexpected Baichuan magic ${magic.toString(16)}`);

    const msgClass = buf.readUInt16LE(18);
    const header: BcHeader = {
        msgId: buf.readUInt32LE(4),
        bodyLen: buf.readUInt32LE(8),
        channelId: buf.readUInt8(12),
        streamType: buf.readUInt8(13),
        msgNum: buf.readUInt16LE(14),
        responseCode: buf.readUInt16LE(16),
        msgClass,
    };
    if (headerLenForClass(msgClass) === 24)
        header.binOffset = buf.readUInt32LE(20);
    return header;
}

/**
 * Combines an (already encrypted) Extension XML block with an (already
 * encrypted, or raw binary) payload into a single message body, and works
 * out the `binOffset` that tells the receiver where the extension ends and
 * the payload begins. Mirrors the framing implied by go2rtc's `bc_ext` /
 * `bc_payload` split and confirmed live: when only one of the two parts is
 * present, `binOffset` is omitted (undefined) unless a raw binary payload
 * follows the extension, in which case it marks the boundary.
 */
export function buildBody(parts: { extension?: Buffer; payload?: Buffer; binary?: Buffer }): { body: Buffer; binOffset?: number } {
    const chunks: Buffer[] = [];
    let binOffset: number | undefined;

    if (parts.extension) {
        chunks.push(parts.extension);
        binOffset = parts.extension.length;
    }
    if (parts.payload) {
        chunks.push(parts.payload);
        if (binOffset === undefined && parts.binary)
            binOffset = chunks.reduce((n, c) => n + c.length, 0);
    }
    if (parts.binary) {
        chunks.push(parts.binary);
        if (binOffset === undefined)
            binOffset = 0;
    }

    return { body: Buffer.concat(chunks), binOffset };
}

/** Magic header for a Baichuan ADPCM media block ("bw10" as a little-endian u32). */
const BCMEDIA_ADPCM_MAGIC = 0x62773130;
/** Magic marking the inner ADPCM sub-header within a bcmedia block. */
const BCMEDIA_ADPCM_HEADER = 0x0100;
const BCMEDIA_PAD_SIZE = 8;

/**
 * Wraps one already-ADPCM-encoded block (predictor header + nibble data, as
 * produced by `AdpcmEncoder.encodeBlock`) in the bcmedia framing expected
 * for a `Talk` (msg id 202) binary payload, and pads to an 8-byte boundary
 * as the device's own media messages do. `seq` is a simple incrementing
 * per-session counter, echoed back at offset 10-12 of the frame.
 */
export function serializeTalkAdpcmBlock(block: Buffer, seq: number): Buffer {
    const payloadSize = block.length + 4;
    const pad = (BCMEDIA_PAD_SIZE - (payloadSize % BCMEDIA_PAD_SIZE)) % BCMEDIA_PAD_SIZE;
    const out = Buffer.alloc(8 + payloadSize + pad);
    out.writeUInt32LE(BCMEDIA_ADPCM_MAGIC, 0);
    out.writeUInt16LE(payloadSize, 4);
    out.writeUInt16LE(payloadSize, 6);
    out.writeUInt16LE(BCMEDIA_ADPCM_HEADER, 8);
    out.writeUInt16LE(seq & 0xffff, 10);
    block.copy(out, 12);
    return out;
}

/**
 * Splits a received body into its extension and payload/binary parts using
 * the header's `binOffset`, without decrypting either part (that's
 * crypto.ts's job, since the two parts may use different offsets for the BC
 * XOR cipher).
 */
export function splitBody(header: BcHeader, body: Buffer): { extension?: Buffer; rest?: Buffer } {
    if (header.binOffset === undefined || header.binOffset === 0)
        return { rest: body.length ? body : undefined };
    return {
        extension: body.subarray(0, header.binOffset),
        rest: body.subarray(header.binOffset),
    };
}
