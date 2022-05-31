import type { RtpPacket } from "@koush/werift-src/packages/rtp/src/rtp/rtp";
import { isNextSequenceNumber, JitterBuffer } from "./jitter-buffer";

// https://yumichan.net/video-processing/video-compression/introduction-to-h264-nal-unit/
export const NAL_TYPE_STAP_A = 24;
export const NAL_TYPE_FU_A = 28;
export const NAL_TYPE_NON_IDR = 1;
export const NAL_TYPE_IDR = 5;
export const NAL_TYPE_SEI = 6;
export const NAL_TYPE_SPS = 7;
export const NAL_TYPE_PPS = 8;
export const NAL_TYPE_DELIMITER = 9;

const NAL_HEADER_SIZE = 1;
const FU_A_HEADER_SIZE = 2;
const LENGTH_FIELD_SIZE = 2;
const STAP_A_HEADER_SIZE = NAL_HEADER_SIZE + LENGTH_FIELD_SIZE;


// a stap a packet is a packet that aggregates multiple nals
function depacketizeStapA(data: Buffer) {
    const ret: Buffer[] = [];
    let lastPos: number;
    let pos = NAL_HEADER_SIZE;
    while (pos < data.length) {
        if (lastPos !== undefined)
            ret.push(data.subarray(lastPos, pos));
        const naluSize = data.readUInt16BE(pos);
        pos += LENGTH_FIELD_SIZE;
        lastPos = pos;
        pos += naluSize;
    }
    ret.push(data.subarray(lastPos));
    return ret;
}

function splitBitstream(data: Buffer) {
    const ret: Buffer[] = [];
    let previous = 0;
    let offset = 0;
    const maybeAddSlice = () => {
        const slice = data.subarray(previous, offset);
        if (slice.length)
            ret.push(slice);
        offset += 4;
        previous = offset;
    }

    while (offset < data.length - 4) {
        const startCode = data.readUInt32BE(offset);
        if (startCode === 1) {
            maybeAddSlice();
        }
        else {
            offset++;
        }
    }
    offset = data.length;
    maybeAddSlice();

    return ret;
}

export class H264Repacketizer {
    extraPackets = 0;
    fuaMax: number;
    pendingFuA: RtpPacket[];
    seenStapASps = false;

    constructor(public console: Console, public maxPacketSize: number, public codecInfo: {
        sps: Buffer,
        pps: Buffer,
    }, public jitterBuffer = new JitterBuffer(console, 4)) {
        // 12 is the rtp/srtp header size.
        this.fuaMax = maxPacketSize - FU_A_HEADER_SIZE;;
    }

    ensureCodecInfo() {
        if (!this.codecInfo) {
            this.codecInfo = {
                sps: undefined,
                pps: undefined,
            };
        }
    }

    updateSps(sps: Buffer) {
        this.ensureCodecInfo();
        this.codecInfo.sps = sps;
    }

    updatePps(pps: Buffer) {
        this.ensureCodecInfo();
        this.codecInfo.pps = pps;
    }

    shouldFilter(nalType: number) {
        // currently nothing is filtered, but it seems that some SEI packets cause issues
        // and should be ignored, while others show up in the stap-a sps/pps packet
        // and work just fine. unclear what these packets contain, but handling them properly
        // is one of the last necessary steps to make the rtp sender reliable.
        return false;
        return nalType === NAL_TYPE_SEI;
    }

    // a fragmentation unit (fua) is a NAL unit broken into multiple fragments.
    // https://datatracker.ietf.org/doc/html/rfc6184#section-5.8
    packetizeFuA(data: Buffer, noStart?: boolean, noEnd?: boolean): Buffer[] {
        // handle both normal packets and fua packets.
        // a fua packet can be fragmented easily into smaller packets, as
        // it is already a fragment, and splitting segments is
        // trivial.

        const initialNalType = data[0] & 0x1f;

        if (initialNalType === NAL_TYPE_FU_A) {
            const fnri = data[0] & (0x80 | 0x60);
            const originalNalType = data[1] & 0x1f;
            const isFuStart = !!(data[1] & 0x80);
            const isFuEnd = !!(data[1] & 0x40);
            const isFuMiddle = !isFuStart && !isFuEnd;

            const originalNalHeader = Buffer.from([fnri | originalNalType]);
            data = Buffer.concat([originalNalHeader, data.subarray(FU_A_HEADER_SIZE)]);

            if (isFuStart) {
                noEnd = true;
            }
            else if (isFuEnd) {
                noStart = true;
            }
            else if (isFuMiddle) {
                noStart = true;
                noEnd = true;
            }
        }

        const fnri = data[0] & (0x80 | 0x60);
        const nalType = data[0] & 0x1F;

        const fuIndicator = fnri | NAL_TYPE_FU_A;

        const fuHeaderMiddle = Buffer.from([fuIndicator, nalType]);
        const fuHeaderStart = noStart ? fuHeaderMiddle : Buffer.from([fuIndicator, nalType | 0x80]);
        const fuHeaderEnd = noEnd ? fuHeaderMiddle : Buffer.from([fuIndicator, nalType | 0x40]);
        let fuHeader = fuHeaderStart;

        const packages: Buffer[] = [];
        let offset = NAL_HEADER_SIZE;

        while (offset < data.length) {
            let payload: Buffer;
            const packageSize = Math.min(this.fuaMax, data.length - offset);
            payload = data.subarray(offset, offset + packageSize);
            offset += packageSize;

            if (offset === data.length) {
                fuHeader = fuHeaderEnd;
            }

            packages.push(Buffer.concat([fuHeader, payload]));

            fuHeader = fuHeaderMiddle;
        }

        return packages;
    }

    // https://datatracker.ietf.org/doc/html/rfc6184#section-5.7.1
    packetizeOneStapA(datas: Buffer[]): Buffer {
        const payload: Buffer[] = [];

        if (!datas.length)
            throw new Error('packetizeOneStapA requires at least one NAL');

        let counter = 0;
        let availableSize = this.maxPacketSize - STAP_A_HEADER_SIZE;

        // h264/rtp spec: https://datatracker.ietf.org/doc/html/rfc6184#section-5.6
        // The value of NRI MUST be the maximum of all the NAL units carried
        // in the aggregation packet.

        // homekit does not want NRI aggregation in the sps/pps stap-a for some reason?
        const stapHeader = NAL_TYPE_STAP_A;

        while (datas.length && datas[0].length + LENGTH_FIELD_SIZE <= availableSize && counter < 9) {
            const nalu = datas.shift();
            availableSize -= LENGTH_FIELD_SIZE + nalu.length;
            counter += 1;
            const packed = Buffer.alloc(2);
            packed.writeUInt16BE(nalu.length, 0);
            payload.push(packed, nalu);
        }

        // is this possible?
        if (counter === 0) {
            this.console.warn('stap a packet is too large. this may be a bug.');
            return datas.shift();
        }

        payload.unshift(Buffer.from([stapHeader]));
        return Buffer.concat(payload);
    }

    packetizeStapA(datas: Buffer[]) {
        const ret: Buffer[] = [];
        while (datas.length) {
            ret.push(this.packetizeOneStapA(datas));
        }
        return ret;
    }

    createPacket(rtp: RtpPacket, data: Buffer, marker: boolean) {
        const ret = rtp.clone();
        ret.header.sequenceNumber = (rtp.header.sequenceNumber + this.extraPackets + 0x10000) % 0x10000;
        ret.header.marker = marker;
        ret.header.padding = false;
        ret.payload = data;
        if (data.length > this.maxPacketSize)
            this.console.warn('packet exceeded max packet size. this may a bug.');
        return ret;
    }

    flushPendingFuA(ret: RtpPacket[]) {
        if (!this.pendingFuA)
            return;

        // defragmenting assumes packets are sorted by sequence number,
        // and are all available, which is guaranteed over rtsp/tcp, but not over rtp/udp.
        const first = this.pendingFuA[0];
        const last = this.pendingFuA[this.pendingFuA.length - 1];
        const originalNalType = first.payload[1] & 0x1f;
        const hasFuStart = !!(first.payload[1] & 0x80);
        const hasFuEnd = !!(last.payload[1] & 0x40);

        const fnri = first.payload[0] & (0x80 | 0x60);
        const originalNalHeader = Buffer.from([fnri | originalNalType]);

        const originalFragments = this.pendingFuA.map(packet => packet.payload.subarray(FU_A_HEADER_SIZE));
        originalFragments.unshift(originalNalHeader);
        const defragmented = Buffer.concat(originalFragments);

        // have seen cameras that toss sps/pps/idr into a fua, delimited by start codes?
        // this probably is not compliant...
        // so the fua packet looks like:
        // sps | start code | pps | start code | idr
        if (originalNalType === NAL_TYPE_SPS) {
            const splits = splitBitstream(defragmented);
            while (splits.length) {
                const split = splits.shift();
                const splitNaluType = split[0] & 0x1f;
                if (splitNaluType === NAL_TYPE_SPS) {
                    this.updateSps(split);
                }
                else if (splitNaluType === NAL_TYPE_PPS) {
                    this.updatePps(split);
                }
                else {
                    if (splitNaluType === NAL_TYPE_IDR)
                        this.maybeSendSpsPps(first, ret);

                    this.fragment(first, ret, {
                        payload: split,
                        noStart: !hasFuStart,
                        noEnd: !hasFuEnd,
                        marker: last.header.marker,
                    });
                }
            }
        }
        else {
            this.fragment(first, ret, {
                payload: defragmented,
                noStart: !hasFuStart,
                noEnd: !hasFuEnd,
                marker: last.header.marker
            });
        }

        this.extraPackets -= this.pendingFuA.length - 1;
        this.pendingFuA = undefined;
    }

    createRtpPackets(packet: RtpPacket, nalus: Buffer[], ret: RtpPacket[], hadMarker = packet.header.marker) {
        nalus.forEach((packetized, index) => {
            if (index !== 0)
                this.extraPackets++;
            const marker = hadMarker && index === nalus.length - 1;
            ret.push(this.createPacket(packet, packetized, marker));
        });
    }

    maybeSendSpsPps(packet: RtpPacket, ret: RtpPacket[]) {
        if (!this.codecInfo?.sps || !this.codecInfo?.pps)
            return;

        const aggregates = this.packetizeStapA([this.codecInfo.sps, this.codecInfo.pps]);
        if (aggregates.length !== 1) {
            this.console.error('expected only 1 packet for sps/pps stapa');
            return;
        }
        this.createRtpPackets(packet, aggregates, ret);
        this.extraPackets++;
    }

    // given the packet, fragment it into multiple packets as needed.
    // a fragment of a payload may be provided via fuaOptions.
    fragment(packet: RtpPacket, ret: RtpPacket[], fuaOptions: {
        payload: Buffer;
        noStart: boolean;
        noEnd: boolean;
        marker: boolean;
    } = {
            payload: packet.payload,
            noStart: false,
            noEnd: false,
            marker: packet.header.marker
        }) {
        const { payload, noStart, noEnd, marker } = fuaOptions;
        if (payload.length > this.maxPacketSize || noStart || noEnd) {
            const fragments = this.packetizeFuA(payload, noStart, noEnd);
            this.createRtpPackets(packet, fragments, ret, marker);
        }
        else {
            // can send this packet as is!
            ret.push(this.createPacket(packet, payload, marker));
        }
    }

    repacketize(packet: RtpPacket): RtpPacket[] {
        const ret: RtpPacket[] = [];
        for (const dejittered of this.jitterBuffer.queue(packet)) {
            this.repacketizeOne(dejittered, ret);
        }
        return ret;
    }

    repacketizeOne(packet: RtpPacket, ret: RtpPacket[]) {

        // empty packets are apparently valid from webrtc. filter those out.
        if (!packet.payload.length) {
            this.flushPendingFuA(ret);
            this.extraPackets--;
            return;
        }

        const nalType = packet.payload[0] & 0x1F;

        // fragmented packets must share a timestamp
        if (this.pendingFuA && this.pendingFuA[0].header.timestamp !== packet.header.timestamp) {
            this.flushPendingFuA(ret);
        }

        if (nalType === NAL_TYPE_FU_A) {
            const data = packet.payload;
            const originalNalType = data[1] & 0x1f;

            if (this.shouldFilter(originalNalType)) {
                this.extraPackets--;
                return;
            }

            const isFuStart = !!(data[1] & 0x80);
            const isFuEnd = !!(packet.payload[1] & 0x40);

            if (isFuStart) {
                if (this.pendingFuA)
                    this.console.error('fua restarted. skipping refragmentation of previous fua.', originalNalType);

                this.pendingFuA = [];

                // if this is an idr frame, but no sps has been sent via a stapa, dummy one up.
                // the stream may not contain codec information in stapa or may be sending it
                // in separate sps/pps packets which is not supported by homekit.
                if (originalNalType === NAL_TYPE_IDR && !this.seenStapASps)
                    this.maybeSendSpsPps(packet, ret);
            }
            else {
                // packet was missing earlier in fua packets, so this packet has to be dropped.
                if (!this.pendingFuA)
                    return;

                const last = this.pendingFuA[this.pendingFuA.length - 1];
                if (!isNextSequenceNumber(last.header.sequenceNumber, packet.header.sequenceNumber)) {
                    this.console.error('fua packet missing. skipping refragmentation.', originalNalType);
                    this.pendingFuA = undefined;
                    return;
                }
            }

            this.pendingFuA.push(packet);

            if (isFuEnd) {
                this.flushPendingFuA(ret);
            }
            else if (this.pendingFuA.reduce((p, c) => p + c.payload.length - FU_A_HEADER_SIZE, NAL_HEADER_SIZE) > this.maxPacketSize) {
                // refragment fua packets as they are received, saving the last undersized packet for
                // the next fua packet.
                const last = this.pendingFuA[this.pendingFuA.length - 1].clone();
                const partial: RtpPacket[] = [];
                this.flushPendingFuA(partial);
                const retain = partial.pop();
                last.payload = retain.payload;
                this.pendingFuA = [last];
                ret.push(...partial);
            }
        }
        else if (nalType === NAL_TYPE_STAP_A) {
            this.flushPendingFuA(ret);

            // break the aggregated packet up and send it.
            const depacketized = depacketizeStapA(packet.payload)
                .filter(payload => {
                    const nalType = payload[0] & 0x1F;
                    this.seenStapASps = this.seenStapASps || (nalType === NAL_TYPE_SPS);
                    if (this.shouldFilter(nalType)) {
                        return false;
                    }
                    return true;
                });
            if (depacketized.length === 0) {
                this.extraPackets--;
                return;
            }
            const aggregates = this.packetizeStapA(depacketized);
            this.createRtpPackets(packet, aggregates, ret);
        }
        else if (nalType >= 1 && nalType < 24) {
            this.flushPendingFuA(ret);

            if (this.shouldFilter(nalType)) {
                this.extraPackets--;
                return;
            }

            // codec information should be aggregated into a stapa. usually around 50 bytes total.
            if (nalType === NAL_TYPE_SPS) {
                this.extraPackets--;
                this.updateSps(packet.payload);
                return;
            }
            else if (nalType === NAL_TYPE_PPS) {
                this.extraPackets--;
                this.updatePps(packet.payload);
                return;
            }

            if (this.shouldFilter(nalType)) {
                this.extraPackets--;
                return;
            }

            if (nalType === NAL_TYPE_IDR && !this.seenStapASps) {
                // if this is an idr frame, but no sps has been sent, dummy one up.
                // the stream may not contain sps.
                this.maybeSendSpsPps(packet, ret);
            }

            this.fragment(packet, ret);
        }
        else {
            this.console.error('unknown nal unit type ' + nalType);
            this.extraPackets--;
        }

        return;
    }
}
