import type { RtpPacket } from "@koush/werift-src/packages/rtp/src/rtp/rtp";

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

export class H264Repacketizer {
    extraPackets = 0;
    fuaMax: number;
    pendingStapA: RtpPacket[];
    pendingFuA: RtpPacket[];
    seenSps = false;

    constructor(public console: Console, public maxPacketSize: number, public codecInfo: {
        sps: Buffer,
        pps: Buffer,
    }) {
        // 12 is the rtp/srtp header size.
        this.fuaMax = maxPacketSize - FU_A_HEADER_SIZE;;
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

        const payloadSize = data.length - NAL_HEADER_SIZE;

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
        const originalSequenceNumber = rtp.header.sequenceNumber;
        const originalMarker = rtp.header.marker;
        // homekit chokes on padding.
        const hadPadding = rtp.header.padding;
        const originalPayload = rtp.payload;
        rtp.header.sequenceNumber = (rtp.header.sequenceNumber + this.extraPackets + 0x10000) % 0x10000;
        rtp.header.marker = marker;
        rtp.header.padding = false;
        rtp.payload = data;
        const ret = rtp.serialize();
        rtp.header.sequenceNumber = originalSequenceNumber;
        rtp.header.marker = originalMarker;
        rtp.header.padding = hadPadding;
        rtp.payload = originalPayload;
        if (data.length > this.maxPacketSize)
            this.console.warn('packet exceeded max packet size. this may a bug.');
        return ret;
    }

    flushPendingStapA(ret: Buffer[]) {
        if (!this.pendingStapA)
            return;
        const first = this.pendingStapA[0];
        const hadMarker = first.header.marker;

        const aggregates = this.packetizeStapA(this.pendingStapA.map(packet => packet.payload));
        if (aggregates.length !== 1) {
            this.console.error('expected only 1 packet for sps/pps stapa');
            this.pendingStapA = undefined;
            return;
        }

        aggregates.forEach((packetized, index) => {
            const marker = hadMarker && index === aggregates.length - 1;
            ret.push(this.createPacket(first, packetized, marker));
        });

        this.extraPackets -= this.pendingStapA.length - 1;
        this.pendingStapA = undefined;
    }

    flushPendingFuA(ret: Buffer[]) {
        if (!this.pendingFuA)
            return;

        // defragmenting assumes packets are sorted by sequence number,
        // and are all available, which is guaranteed over rtsp/tcp, but not over rtp/udp.
        const first = this.pendingFuA[0];
        const last = this.pendingFuA[this.pendingFuA.length - 1];

        const hasFuStart = !!(first.payload[1] & 0x80);
        const hasFuEnd = !!(last.payload[1] & 0x40);

        let originalNalType = first.payload[1] & 0x1f;
        let lastSequenceNumber: number;
        for (const packet of this.pendingFuA) {
            const nalType = packet.payload[1] & 0x1f;
            if (nalType !== originalNalType) {
                this.console.error('nal type mismatch');
                this.pendingFuA = undefined;
                return;
            }
            if (lastSequenceNumber !== undefined) {
                if (packet.header.sequenceNumber !== (lastSequenceNumber + 1) % 0x10000) {
                    this.console.error('fua packet is missing. skipping refragmentation.');
                    this.pendingFuA = undefined;
                    return;
                }
            }
            lastSequenceNumber = packet.header.sequenceNumber;
        }

        const fnri = first.payload[0] & (0x80 | 0x60);
        const originalNalHeader = Buffer.from([fnri | originalNalType]);

        const originalFragments = this.pendingFuA.map(packet => packet.payload.subarray(FU_A_HEADER_SIZE));
        originalFragments.unshift(originalNalHeader);
        const defragmented = Buffer.concat(originalFragments);

        const fragments = this.packetizeFuA(defragmented, !hasFuStart, !hasFuEnd);
        const hadMarker = last.header.marker;
        this.createRtpPackets(first, fragments, ret, hadMarker);

        this.extraPackets -= this.pendingFuA.length - 1;

        this.pendingFuA = undefined;
    }

    createRtpPackets(packet: RtpPacket, nalus: Buffer[], ret: Buffer[], hadMarker = packet.header.marker) {
        nalus.forEach((packetized, index) => {
            if (index !== 0)
                this.extraPackets++;
            const marker = hadMarker && index === nalus.length - 1;
            ret.push(this.createPacket(packet, packetized, marker));
        });
    }

    maybeSendSpsPps(packet: RtpPacket, ret: Buffer[]) {
        if (!this.codecInfo.sps || !this.codecInfo.pps)
            return;

        const aggregates = this.packetizeStapA([this.codecInfo.sps, this.codecInfo.pps]);
        if (aggregates.length !== 1) {
            this.console.error('expected only 1 packet for sps/pps stapa');
            return;
        }
        this.createRtpPackets(packet, aggregates, ret);
        this.extraPackets++;
    }

    repacketize(packet: RtpPacket): Buffer[] {
        const ret: Buffer[] = [];

        // empty packets are apparently valid from webrtc. filter those out.
        if (!packet.payload.length) {
            this.extraPackets--;
            return ret;
        }

        const nalType = packet.payload[0] & 0x1F;

        // fragmented packets must share a timestamp
        if (this.pendingFuA && this.pendingFuA[0].header.timestamp !== packet.header.timestamp) {
            this.flushPendingFuA(ret);
        }

        // stapa packets must share the same timestamp
        if (this.pendingStapA && this.pendingStapA[0].header.timestamp !== packet.header.timestamp) {
            this.flushPendingStapA(ret);
        }

        if (nalType === NAL_TYPE_FU_A) {
            // fua may share a timestamp as stapa, but don't aggregated with stapa
            this.flushPendingStapA(ret);

            const data = packet.payload;
            const originalNalType = data[1] & 0x1f;

            if (this.shouldFilter(originalNalType)) {
                this.extraPackets--;
                return ret;
            }

            const isFuStart = !!(data[1] & 0x80);
            // if this is an idr frame, but no sps has been sent, dummy one up.
            // the stream may not contain sps.
            if (originalNalType === NAL_TYPE_IDR && isFuStart && !this.seenSps) {
                this.maybeSendSpsPps(packet, ret);
            }

            if (!this.pendingFuA) {
                // the fua packet may already fit, in which case we could just send it.
                // but for some reason that doesn't work??
                if (false && packet.payload.length <= this.maxPacketSize) {
                    const isFuEnd = !!(data[1] & 0x40);
                    ret.push(this.createPacket(packet, packet.payload, packet.header.marker && isFuEnd));
                }
                else if (packet.payload.length >= this.maxPacketSize * 2) {
                    // most rtsp implementations send fat fua packets ~64k. can just repacketize those
                    // with minimal extra packet overhead.
                    const fragments = this.packetizeFuA(packet.payload);
                    this.createRtpPackets(packet, fragments, ret);
                }
                else {
                    // the fua packet is an unsuitable size and needs to be defragmented
                    // and refragmented.
                    this.pendingFuA = [];
                }
            }

            if (this.pendingFuA) {
                this.pendingFuA.push(packet);

                const isFuEnd = !!(packet.payload[1] & 0x40);
                if (isFuEnd)
                    this.flushPendingFuA(ret);
            }
        }
        else if (nalType === NAL_TYPE_STAP_A) {
            this.flushPendingFuA(ret);

            // break the aggregated packet up and send it.
            const depacketized = depacketizeStapA(packet.payload)
                .filter(payload => {
                    const nalType = payload[0] & 0x1F;
                    this.seenSps = this.seenSps || (nalType === NAL_TYPE_SPS);
                    if (this.shouldFilter(nalType)) {
                        return false;
                    }
                    return true;
                });
            if (depacketized.length === 0) {
                this.extraPackets--;
                return ret;
            }
            const aggregates = this.packetizeStapA(depacketized);
            this.createRtpPackets(packet, aggregates, ret);
        }
        else if (nalType >= 1 && nalType < 24) {
            this.flushPendingFuA(ret);

            if (this.shouldFilter(nalType)) {
                this.flushPendingStapA(ret);
                this.extraPackets--;
                return ret;
            }

            // codec information should be aggregated. usually around 50 bytes total.
            if (nalType === NAL_TYPE_SPS || nalType === NAL_TYPE_PPS) {
                this.seenSps = this.seenSps || (nalType === NAL_TYPE_SPS);
                if (!this.pendingStapA)
                    this.pendingStapA = [];
                this.pendingStapA.push(packet);
                return ret;
            }

            this.flushPendingStapA(ret);

            if (this.shouldFilter(nalType)) {
                this.extraPackets--;
                return ret;
            }

            if (nalType === NAL_TYPE_IDR && !this.seenSps) {
                // if this is an idr frame, but no sps has been sent, dummy one up.
                // the stream may not contain sps.
                this.maybeSendSpsPps(packet, ret);
            }

            if (packet.payload.length > this.maxPacketSize) {
                const fragments = this.packetizeFuA(packet.payload);
                this.createRtpPackets(packet, fragments, ret);
            }
            else {
                // can send this packet as is!
                ret.push(this.createPacket(packet, packet.payload, packet.header.marker));
            }
        }
        else {
            this.console.error('unknown nal unit type ' + nalType);
            this.extraPackets--;
        }

        return ret;
    }
}
