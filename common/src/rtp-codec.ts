import { randomBytes } from 'crypto';
import { RtspServer, RtspStreamParser } from './rtsp-server';
import { StreamChunk, StreamParserOptions } from './stream-parser';
import { RtpPacket } from '@koush/werift-src/packages/rtp/src/rtp/rtp';

// https://yumichan.net/video-processing/video-compression/introduction-to-h264-nal-unit/

export const H264_NAL_TYPE_RESERVED0 = 0;
export const H264_NAL_TYPE_RESERVED30 = 30;
export const H264_NAL_TYPE_RESERVED31 = 31;

export const H264_NAL_TYPE_IDR = 5;
export const H264_NAL_TYPE_SEI = 6;
export const H264_NAL_TYPE_SPS = 7;
export const H264_NAL_TYPE_PPS = 8;
// aggregate NAL Unit
export const H264_NAL_TYPE_STAP_A = 24;
export const H264_NAL_TYPE_STAP_B = 25;
// fragmented NAL Unit (need to match against first)
export const H264_NAL_TYPE_FU_A = 28;
export const H264_NAL_TYPE_FU_B = 29;

export const H264_NAL_TYPE_MTAP16 = 26;
export const H264_NAL_TYPE_MTAP32 = 27;

export const H265_NAL_TYPE_AGG = 48;
export const H265_NAL_TYPE_VPS = 32;
export const H265_NAL_TYPE_SPS = 33;
export const H265_NAL_TYPE_PPS = 34;
export const H265_NAL_TYPE_BLA_W_LP = 16;
export const H265_NAL_TYPE_BLA_W_RADL = 17;
export const H265_NAL_TYPE_BLA_N_LP = 18;
export const H265_NAL_TYPE_IDR_W_RADL = 19;
export const H265_NAL_TYPE_IDR_N_LP = 20;
export const H265_NAL_TYPE_CRA_NUT = 21;
export const H265_NAL_TYPE_FU = 49;
export const H265_NAL_TYPE_SEI_PREFIX = 39;
export const H265_NAL_TYPE_SEI_SUFFIX = 40;

function getRtpPayload(rtp: Buffer) {
    const parsed = RtpPacket.deSerialize(rtp);
    return parsed.payload;
}

export function findH264NaluType(streamChunk: StreamChunk, naluType: number) {
    if (streamChunk.type !== 'h264')
        return;
    return findH264NaluTypeInNalu(getRtpPayload(streamChunk.chunks[streamChunk.chunks.length - 1]), naluType);
}

export function findH265NaluType(streamChunk: StreamChunk, naluType: number) {
    if (streamChunk.type !== 'h265')
        return;
    return findH265NaluTypeInNalu(getRtpPayload(streamChunk.chunks[streamChunk.chunks.length - 1]), naluType);
}

export function parseH264NaluType(firstNaluByte: number) {
    return firstNaluByte & 0x1f;
}

export function findH264NaluTypeInNalu(nalu: Buffer, naluType: number) {
    const checkNaluType = parseH264NaluType(nalu[0]);
    if (checkNaluType === H264_NAL_TYPE_STAP_A) {
        let pos = 1;
        while (pos < nalu.length) {
            const naluLength = nalu.readUInt16BE(pos);
            pos += 2;
            const stapaType = parseH264NaluType(nalu[pos]);
            if (stapaType === naluType)
                return nalu.subarray(pos, pos + naluLength);
            pos += naluLength;
        }
    }
    else if (checkNaluType === H264_NAL_TYPE_FU_A) {
        const fuaType = parseH264NaluType(nalu[1]);
        const isFuStart = !!(nalu[1] & 0x80);

        if (fuaType === naluType && isFuStart)
            return nalu.subarray(1);
    }
    else if (checkNaluType === naluType) {
        return nalu;
    }
    return;
}

function parseH265NaluType(firstNaluByte: number) {
    return (firstNaluByte & 0b01111110) >> 1;
}

export function findH265NaluTypeInNalu(nalu: Buffer, naluType: number) {
    const checkNaluType = parseH265NaluType(nalu[0]);
    if (checkNaluType === H265_NAL_TYPE_AGG) {
        let pos = 1;
        while (pos < nalu.length) {
            const naluLength = nalu.readUInt16BE(pos);
            pos += 2;
            const stapaType = parseH265NaluType(nalu[pos]);
            if (stapaType === naluType)
                return nalu.subarray(pos, pos + naluLength);
            pos += naluLength;
        }
    }
    else if (checkNaluType === naluType) {
        return nalu;
    }
    return;
}

export function getStartedH264NaluTypes(streamChunk: StreamChunk) {
    if (streamChunk.type !== 'h264')
        return new Set<number>();
    return getNaluTypesInNalu(getRtpPayload(streamChunk.chunks[streamChunk.chunks.length - 1]), true)
}

export function getNaluTypesInNalu(nalu: Buffer, fuaRequireStart = false, fuaRequireEnd = false) {
    const ret = new Set<number>();
    const naluType = parseH264NaluType(nalu[0]);
    if (naluType === H264_NAL_TYPE_STAP_A) {
        ret.add(H264_NAL_TYPE_STAP_A);
        let pos = 1;
        while (pos < nalu.length) {
            const naluLength = nalu.readUInt16BE(pos);
            pos += 2;
            const stapaType = parseH264NaluType(nalu[pos]);
            ret.add(stapaType);
            pos += naluLength;
        }
    }
    else if (naluType === H264_NAL_TYPE_FU_A) {
        ret.add(H264_NAL_TYPE_FU_A);
        const fuaType = parseH264NaluType(nalu[1]);
        if (fuaRequireStart) {
            const isFuStart = !!(nalu[1] & 0x80);
            if (isFuStart)
                ret.add(fuaType);
        }
        else if (fuaRequireEnd) {
            const isFuEnd = !!(nalu[1] & 0x40);
            if (isFuEnd)
                ret.add(fuaType);
        }
        else {
            ret.add(fuaType);
        }
    }
    else {
        ret.add(naluType);
    }

    return ret;
}

export function getStartedH265NaluTypes(streamChunk: StreamChunk) {
    if (streamChunk.type !== 'h265')
        return new Set<number>();
    return getNaluTypesInH265Nalu(getRtpPayload(streamChunk.chunks[streamChunk.chunks.length - 1]), true)
}

export function getNaluTypesInH265Nalu(nalu: Buffer, fuaRequireStart = false, fuaRequireEnd = false) {
    const ret = new Set<number>();
    const naluType = parseH265NaluType(nalu[0]);
    if (naluType === H265_NAL_TYPE_AGG) {
        ret.add(H265_NAL_TYPE_AGG);
        let pos = 2;
        while (pos < nalu.length) {
            const naluLength = nalu.readUInt16BE(pos);
            pos += 2;
            const stapaType = parseH265NaluType(nalu[pos]);
            ret.add(stapaType);
            pos += naluLength;
        }
    }
    else if (naluType === H265_NAL_TYPE_FU) {
        ret.add(H265_NAL_TYPE_FU);
        const fuaType = nalu[2] & 0x3F;  // 6 bits
        if (fuaRequireStart) {
            const isFuStart = !!(nalu[2] & 0x80);
            if (isFuStart)
                ret.add(fuaType);
        }
        else if (fuaRequireEnd) {
            const isFuEnd = !!(nalu[2] & 0x40);
            if (isFuEnd)
                ret.add(fuaType);
        }
        else {
            ret.add(fuaType);
        }
    }
    else {
        ret.add(naluType);
    }

    return ret;
}

export function isH265KeyFrameRelatedInSet(naluTypes: Set<number>, allowCodecInfo = true) {
    if (naluTypes.has(H265_NAL_TYPE_IDR_N_LP)
        || naluTypes.has(H265_NAL_TYPE_IDR_W_RADL)
        || naluTypes.has(H265_NAL_TYPE_CRA_NUT)
        || naluTypes.has(H265_NAL_TYPE_BLA_N_LP)
        || naluTypes.has(H265_NAL_TYPE_BLA_W_LP)
        || naluTypes.has(H265_NAL_TYPE_BLA_W_RADL)) {
        return true;
    }

    if (allowCodecInfo) {
        if (naluTypes.has(H265_NAL_TYPE_VPS)
            || naluTypes.has(H265_NAL_TYPE_SPS)
            || naluTypes.has(H265_NAL_TYPE_PPS))
            return true;
    }
    return false;
}


export function createRtspParser(options?: StreamParserOptions): RtspStreamParser {
    let resolve: any;

    return {
        container: 'rtsp',
        tcpProtocol: 'rtsp://127.0.0.1/' + randomBytes(8).toString('hex'),
        inputArguments: [
            '-rtsp_transport',
            'tcp',
        ],
        outputArguments: [
            '-rtsp_transport',
            'tcp',
            ...(options?.vcodec || []),
            ...(options?.acodec || []),
            // linux and windows seem to support 64000 but darwin is 32000?
            '-pkt_size', '32000',
            '-f', 'rtsp',
        ],
        findSyncFrame(streamChunks: StreamChunk[]) {
            for (let prebufferIndex = 0; prebufferIndex < streamChunks.length; prebufferIndex++) {
                const streamChunk = streamChunks[prebufferIndex];
                if (streamChunk.type === 'h264') {
                    const naluTypes = getStartedH264NaluTypes(streamChunk);
                    if (naluTypes.has(H264_NAL_TYPE_SPS) || naluTypes.has(H264_NAL_TYPE_IDR)) {
                        return streamChunks.slice(prebufferIndex);
                    }
                }
                else if (streamChunk.type === 'h265') {
                    const naluTypes = getStartedH265NaluTypes(streamChunk);

                    if (isH265KeyFrameRelatedInSet(naluTypes)) {
                        return streamChunks.slice(prebufferIndex);
                    }
                }
            }

            // oh well!
        },
        sdp: new Promise<string>(r => resolve = r),
        async *parse(duplex, width, height) {
            const server = new RtspServer(duplex);
            await server.handleSetup();
            resolve(server.sdp);
            for await (const { type, rtcp, header, packet } of server.handleRecord()) {
                yield {
                    chunks: [header, packet],
                    type: `${rtcp ? 'rtcp-' : ''}${type}`,
                    width,
                    height,
                }
            }
        }
    }
}
