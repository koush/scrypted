import { isNextSequenceNumber, JitterBuffer, RtpPacket } from "../../homekit/src/types/camera/jitter-buffer";

// H.265 NAL unit types
// https://github.com/FFmpeg/FFmpeg/blob/master/libavcodec/hevc/hevc.h
const NAL_TYPE_TRAIL_N = 0;
const NAL_TYPE_TRAIL_R = 1;
const NAL_TYPE_TSA_N = 2;
const NAL_TYPE_TSA_R = 3;
const NAL_TYPE_STSA_N = 4;
const NAL_TYPE_STSA_R = 5;
const NAL_TYPE_RADL_N = 6;
const NAL_TYPE_RADL_R = 7;
const NAL_TYPE_RASL_N = 8;
const NAL_TYPE_RASL_R = 9;
const NAL_TYPE_VCL_N10 = 10;
const NAL_TYPE_VCL_R11 = 11;
const NAL_TYPE_VCL_N12 = 12;
const NAL_TYPE_VCL_R13 = 13;
const NAL_TYPE_VCL_N14 = 14;
const NAL_TYPE_VCL_R15 = 15;
const NAL_TYPE_BLA_W_LP = 16;
const NAL_TYPE_BLA_W_RADL = 17;
const NAL_TYPE_BLA_N_LP = 18;
const NAL_TYPE_IDR_W_RADL = 19;
const NAL_TYPE_IDR_N_LP = 20;
const NAL_TYPE_CRA_NUT = 21;
const NAL_TYPE_RSV_IRAP_VCL22 = 22;
const NAL_TYPE_RSV_IRAP_VCL23 = 23;
const NAL_TYPE_RSV_VCL24 = 24;
const NAL_TYPE_RSV_VCL25 = 25;
const NAL_TYPE_RSV_VCL26 = 26;
const NAL_TYPE_RSV_VCL27 = 27;
const NAL_TYPE_RSV_VCL28 = 28;
const NAL_TYPE_RSV_VCL29 = 29;
const NAL_TYPE_RSV_VCL30 = 30;
const NAL_TYPE_RSV_VCL31 = 31;
const NAL_TYPE_VPS = 32;
const NAL_TYPE_SPS = 33;
const NAL_TYPE_PPS = 34;
const NAL_TYPE_AUD = 35;
const NAL_TYPE_EOS_NUT = 36;
const NAL_TYPE_EOB_NUT = 37;
const NAL_TYPE_FD_NUT = 38;
const NAL_TYPE_SEI_PREFIX = 39;
const NAL_TYPE_SEI_SUFFIX = 40;
const NAL_TYPE_RSV_NVCL41 = 41;
const NAL_TYPE_RSV_NVCL42 = 42;
const NAL_TYPE_RSV_NVCL43 = 43;
const NAL_TYPE_RSV_NVCL44 = 44;
const NAL_TYPE_RSV_NVCL45 = 45;
const NAL_TYPE_RSV_NVCL46 = 46;
const NAL_TYPE_RSV_NVCL47 = 47;
// RTP payload format for H.265 defines these special types
const NAL_TYPE_AP = 48;  // Aggregation Packet
const NAL_TYPE_FU = 49;  // Fragmentation Unit
const NAL_TYPE_UNSPEC50 = 50;
const NAL_TYPE_UNSPEC51 = 51;
const NAL_TYPE_UNSPEC52 = 52;
const NAL_TYPE_UNSPEC53 = 53;
const NAL_TYPE_UNSPEC54 = 54;
const NAL_TYPE_UNSPEC55 = 55;
const NAL_TYPE_UNSPEC56 = 56;
const NAL_TYPE_UNSPEC57 = 57;
const NAL_TYPE_UNSPEC58 = 58;
const NAL_TYPE_UNSPEC59 = 59;
const NAL_TYPE_UNSPEC60 = 60;
const NAL_TYPE_UNSPEC61 = 61;
const NAL_TYPE_UNSPEC62 = 62;
const NAL_TYPE_UNSPEC63 = 63;


const NAL_HEADER_SIZE = 2;  // H265 has 2-byte NAL header
const FU_HEADER_SIZE = 3;   // 2-byte NAL header + 1-byte FU header
const LENGTH_FIELD_SIZE = 2;
const AP_HEADER_SIZE = NAL_HEADER_SIZE + LENGTH_FIELD_SIZE;

// Function to extract NAL unit type from H.265 NAL header
function getNalType(data: Buffer): number {
    return (data[0] & 0x7E) >> 1;  // 6 bits starting from bit 1
}

// Function to depacketize Aggregation Packets (similar to STAP-A in H.264)
export function depacketizeAP(data: Buffer) {
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

export function splitH265NaluStartCode(data: Buffer) {
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

export interface H265CodecInfo {
    vps: Buffer;
    sps: Buffer;
    pps: Buffer;
    sei?: Buffer;
}

export class H265Repacketizer {
    extraPackets = 0;
    fuMax: number;
    pendingFU: RtpPacket[];
    // the AP packet that will be sent before an IDR frame.
    ap: RtpPacket;
    fuMin: number;

    constructor(public console: Console, private maxPacketSize: number, public codecInfo?: H265CodecInfo, public jitterBuffer = new JitterBuffer(console, 4)) {
        this.setMaxPacketSize(maxPacketSize);
    }

    setMaxPacketSize(maxPacketSize: number) {
        this.maxPacketSize = maxPacketSize;
        // 12 is the rtp/srtp header size.
        this.fuMax = maxPacketSize - FU_HEADER_SIZE;
        this.fuMin = Math.round(maxPacketSize * .8);
    }

    ensureCodecInfo() {
        if (!this.codecInfo) {
            this.codecInfo = {
                vps: undefined,
                sps: undefined,
                pps: undefined,
            };
        }
    }

    updateVps(vps: Buffer) {
        this.ensureCodecInfo();
        this.codecInfo.vps = vps;
    }

    updateSps(sps: Buffer) {
        this.ensureCodecInfo();
        this.codecInfo.sps = sps;
    }

    updatePps(pps: Buffer) {
        this.ensureCodecInfo();
        this.codecInfo.pps = pps;
    }

    updateSei(sei: Buffer) {
        this.ensureCodecInfo();
        this.codecInfo.sei = sei;
    }

    shouldFilter(nalType: number) {
        // Currently nothing is filtered, but this could be customized
        return false;
    }

    // Fragmentation Unit (FU) for H.265
    // https://datatracker.ietf.org/doc/html/rfc7798#section-4.4.3
    packetizeFU(data: Buffer, noStart?: boolean, noEnd?: boolean): Buffer[] {
        // Handle both normal packets and FU packets.
        const initialNalType = getNalType(data);

        // Check if the data is already a fragmentation unit
        if (initialNalType === NAL_TYPE_FU) {
            // Extract original NAL header information
            const originalNalType = data[2] & 0x3F;  // 6 bits
            const isFuStart = !!(data[2] & 0x80);
            const isFuEnd = !!(data[2] & 0x40);
            const isFuMiddle = !isFuStart && !isFuEnd;

            // Reconstruct the original NAL header
            const layerId = ((data[0] & 0x01) << 5) | ((data[1] & 0xF8) >> 3);
            const tid = data[1] & 0x07;

            const originalNalHeader = Buffer.alloc(2);
            originalNalHeader[0] = (originalNalType << 1) | (layerId >> 5);
            originalNalHeader[1] = ((layerId & 0x1F) << 3) | tid;

            data = Buffer.concat([originalNalHeader, data.subarray(FU_HEADER_SIZE)]);

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

        // Extract information from the NAL header
        const nalType = getNalType(data);
        const layerId = ((data[0] & 0x01) << 5) | ((data[1] & 0xF8) >> 3);
        const tid = data[1] & 0x07;

        // Construct the FU NAL header
        const fuNalHeader = Buffer.alloc(2);
        fuNalHeader[0] = (NAL_TYPE_FU << 1) | (layerId >> 5);
        fuNalHeader[1] = ((layerId & 0x1F) << 3) | tid;

        // Construct FU headers for different positions
        const fuHeaderMiddle = Buffer.from([...fuNalHeader, nalType]);
        const fuHeaderStart = noStart ? fuHeaderMiddle : Buffer.from([...fuNalHeader, nalType | 0x80]);
        const fuHeaderEnd = noEnd ? fuHeaderMiddle : Buffer.from([...fuNalHeader, nalType | 0x40]);
        let fuHeader = fuHeaderStart;

        const packages: Buffer[] = [];
        let offset = NAL_HEADER_SIZE;

        while (offset < data.length) {
            let payload: Buffer;
            const packageSize = Math.min(this.fuMax, data.length - offset);
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

    // Aggregation Packet (AP) for H.265 (similar to STAP-A in H.264)
    // https://datatracker.ietf.org/doc/html/rfc7798#section-4.4.2
    packetizeOneAP(datas: Buffer[]): Buffer {
        if (!datas.length)
            throw new Error('packetizeOneAP requires at least one NAL');

        let counter = 0;
        let availableSize = this.maxPacketSize - AP_HEADER_SIZE;

        // In H.265, AP uses a fixed header with NAL type 48
        const apHeader = Buffer.alloc(2);
        apHeader[0] = NAL_TYPE_AP << 1;  // Type 48, no layer ID in first byte
        apHeader[1] = 0x01;  // Default temporal ID = 1, no layer ID

        const payload: Buffer[] = [apHeader];

        while (datas.length && datas[0].length + LENGTH_FIELD_SIZE <= availableSize && counter < 9) {
            const nalu = datas.shift();
            availableSize -= LENGTH_FIELD_SIZE + nalu.length;
            counter += 1;
            const lengthField = Buffer.alloc(2);
            lengthField.writeUInt16BE(nalu.length, 0);
            payload.push(lengthField, nalu);
        }

        // If no NALUs fit, return the first one for FU packetization
        if (counter === 0)
            return datas.shift();

        // A single NALU AP is unnecessary, return the NALU itself
        if (counter === 1) {
            return payload[2]; // Skip header and length field
        }

        return Buffer.concat(payload);
    }

    packetizeAP(datas: Buffer[]) {
        const ret: Buffer[] = [];
        while (datas.length) {
            const nalu = this.packetizeOneAP(datas);
            if (nalu.length < this.maxPacketSize) {
                ret.push(nalu);
                continue;
            }
            const fus = this.packetizeFU(nalu);
            ret.push(...fus);
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
            this.console.warn('packet exceeded max packet size. this may be a bug.');
        return ret;
    }

    flushPendingFU(ret: RtpPacket[]) {
        if (!this.pendingFU)
            return;

        // Defragmenting assumes packets are sorted by sequence number,
        // and are all available, which is guaranteed over rtsp/tcp, but not over rtp/udp.
        const first = this.pendingFU[0];
        const last = this.pendingFU[this.pendingFU.length - 1];
        const originalNalType = first.payload[2] & 0x3F;
        const hasFuStart = !!(first.payload[2] & 0x80);
        const hasFuEnd = !!(last.payload[2] & 0x40);

        // Extract layerId and tid from FU header
        const layerId = ((first.payload[0] & 0x01) << 5) | ((first.payload[1] & 0xF8) >> 3);
        const tid = first.payload[1] & 0x07;

        // Reconstruct original NAL header
        const originalNalHeader = Buffer.alloc(2);
        originalNalHeader[0] = (originalNalType << 1) | (layerId >> 5);
        originalNalHeader[1] = ((layerId & 0x1F) << 3) | tid;

        const getDefragmentedPendingFu = () => {
            const originalFragments = this.pendingFU.map(packet => packet.payload.subarray(FU_HEADER_SIZE));
            originalFragments.unshift(originalNalHeader);
            return Buffer.concat(originalFragments);
        }

        // Handle special case for VPS/SPS/PPS in FU (not standard but seen in some implementations)
        if (originalNalType === NAL_TYPE_VPS || originalNalType === NAL_TYPE_SPS) {
            const defragmented = getDefragmentedPendingFu();
            const splits = splitH265NaluStartCode(defragmented);

            while (splits.length) {
                const split = splits.shift();
                const splitNaluType = getNalType(split);

                if (splitNaluType === NAL_TYPE_VPS) {
                    this.updateVps(split);
                }
                else if (splitNaluType === NAL_TYPE_SPS) {
                    this.updateSps(split);
                }
                else if (splitNaluType === NAL_TYPE_PPS) {
                    this.updatePps(split);
                }
                else {
                    // For IDR frames, send codec info first
                    if (splitNaluType === NAL_TYPE_IDR_W_RADL || splitNaluType === NAL_TYPE_IDR_N_LP) {
                        this.maybeSendAPCodecInfo(first, ret);
                    }

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
            // Process regular fragmentation units
            while (this.pendingFU.length) {
                const fu = this.pendingFU[0];
                if (fu.payload.length > this.maxPacketSize || fu.payload.length < this.fuMin)
                    break;
                this.pendingFU.shift();
                ret.push(this.createPacket(fu, fu.payload, fu.header.marker));
            }

            if (!this.pendingFU.length) {
                this.pendingFU = undefined;
                return;
            }

            // Re-fragment remaining FU packets
            const first = this.pendingFU[0];
            const last = this.pendingFU[this.pendingFU.length - 1];
            const hasFuStart = !!(first.payload[2] & 0x80);
            const hasFuEnd = !!(last.payload[2] & 0x40);

            const defragmented = getDefragmentedPendingFu();

            this.fragment(first, ret, {
                payload: defragmented,
                noStart: !hasFuStart,
                noEnd: !hasFuEnd,
                marker: last.header.marker
            });
        }

        this.extraPackets -= this.pendingFU.length - 1;
        this.pendingFU = undefined;
    }

    createRtpPackets(packet: RtpPacket, nalus: Buffer[], ret: RtpPacket[], hadMarker = packet.header.marker) {
        nalus.forEach((packetized, index) => {
            if (index !== 0)
                this.extraPackets++;
            const marker = hadMarker && index === nalus.length - 1;
            ret.push(this.createPacket(packet, packetized, marker));
        });
    }

    maybeSendAPCodecInfo(packet: RtpPacket, ret: RtpPacket[]) {
        if (this.ap) {
            // AP with codec information was sent recently, no need to send codec info.
            this.ap = undefined;
            return;
        }

        // vps is not required.
        if (!this.codecInfo?.sps || !this.codecInfo?.pps)
            return;

        const agg = [this.codecInfo.sps, this.codecInfo.pps];
        if (this.codecInfo.vps)
            agg.unshift(this.codecInfo.vps);
        if (this.codecInfo?.sei)
            agg.push(this.codecInfo.sei);

        const aggregates = this.packetizeAP(agg);
        if (aggregates.length !== 1) {
            this.console.error('expected only 1 packet for vps/sps/pps AP');
            return;
        }
        // This AP only contains codec info (and no frame data), thus the marker bit should not be set.
        this.createRtpPackets(packet, aggregates, ret, false);
        this.extraPackets++;
    }

    // Fragment payload into multiple packets as needed
    fragment(packet: RtpPacket, ret: RtpPacket[], fuOptions: {
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
        const { payload, noStart, noEnd, marker } = fuOptions;
        if (payload.length > this.maxPacketSize || noStart || noEnd) {
            const fragments = this.packetizeFU(payload, noStart, noEnd);
            this.createRtpPackets(packet, fragments, ret, marker);
        }
        else {
            // Can send this packet as is
            ret.push(this.createPacket(packet, payload, marker));
        }
    }

    repacketize<T extends RtpPacket>(packet: T): T[] {
        const ret: T[] = [];
        for (const dejittered of this.jitterBuffer.queue(packet)) {
            this.repacketizeOne(dejittered, ret);
        }
        return ret;
    }

    repacketizeOne(packet: RtpPacket, ret: RtpPacket[]) {
        // Filter empty packets
        if (!packet.payload.length) {
            this.flushPendingFU(ret);
            this.extraPackets--;
            return;
        }

        const nalType = getNalType(packet.payload);

        // Fragmented packets must share a timestamp
        if (this.pendingFU && this.pendingFU[0].header.timestamp !== packet.header.timestamp) {
            this.flushPendingFU(ret);
        }

        if (nalType === NAL_TYPE_FU) {
            // Handle Fragmentation Units
            const data = packet.payload;
            const originalNalType = data[2] & 0x3F;

            if (this.shouldFilter(originalNalType)) {
                this.extraPackets--;
                return;
            }

            const isFuStart = !!(data[2] & 0x80);
            const isFuEnd = !!(data[2] & 0x40);

            if (isFuStart) {
                if (this.pendingFU)
                    this.console.error('FU restarted. skipping refragmentation of previous FU.', originalNalType);

                this.pendingFU = undefined;

                // If this is an IDR frame, but no codec info has been sent via an AP, send it
                if (originalNalType === NAL_TYPE_IDR_W_RADL || originalNalType === NAL_TYPE_IDR_N_LP) {
                    this.maybeSendAPCodecInfo(packet, ret);
                }
            }
            else {
                if (this.pendingFU) {
                    // Check if packets were missing from the previously queued FU packets
                    const last = this.pendingFU[this.pendingFU.length - 1];
                    if (!isNextSequenceNumber(last.header.sequenceNumber, packet.header.sequenceNumber)) {
                        this.console.error('FU packet missing. skipping refragmentation.', originalNalType);
                        return;
                    }
                }
            }

            if (!this.pendingFU)
                this.pendingFU = [];

            this.pendingFU.push(packet);

            if (isFuEnd) {
                this.flushPendingFU(ret);
            }
            else if (this.pendingFU.reduce((p, c) => p + c.payload.length - FU_HEADER_SIZE, NAL_HEADER_SIZE) > this.maxPacketSize) {
                // Refragment FU packets as they are received
                const last = this.pendingFU[this.pendingFU.length - 1].clone();
                const partial: RtpPacket[] = [];
                this.flushPendingFU(partial);
                // Retain a FU packet to validate subsequent FU packets
                const retain = partial.pop();
                last.payload = retain.payload;
                this.pendingFU = [last];
                ret.push(...partial);
            }
        }
        else if (nalType === NAL_TYPE_AP) {
            this.flushPendingFU(ret);

            let hasVps = false;
            let hasSps = false;
            let hasPps = false;

            // Process Aggregation Packets
            const depacketized = depacketizeAP(packet.payload);
            depacketized.forEach(payload => {
                const nalType = getNalType(payload);
                if (nalType === NAL_TYPE_VPS) {
                    hasVps = true;
                    this.updateVps(payload);
                }
                else if (nalType === NAL_TYPE_SPS) {
                    hasSps = true;
                    this.updateSps(payload);
                }
                else if (nalType === NAL_TYPE_PPS) {
                    hasPps = true;
                    this.updatePps(payload);
                }
                else if (nalType === NAL_TYPE_SEI_PREFIX || nalType === NAL_TYPE_SEI_SUFFIX) {
                    this.updateSei(payload);
                }
                else if (nalType === NAL_TYPE_AUD) {
                    // Access Unit Delimiter - typically a no-op
                }
                else if (nalType >= NAL_TYPE_TRAIL_N && nalType <= NAL_TYPE_RASL_R) {
                    // Various slice types - typically VCL NAL units
                }
                else if (nalType === NAL_TYPE_IDR_W_RADL) {
                    // IDR
                }
                else if (nalType === 0) {
                    // NAL delimiter or something. usually empty.
                }
                else {
                    this.console.warn('Skipped an AP type.', nalType);
                }
            });

            // Log that an AP with codec info was sent
            if (hasVps && hasSps && hasPps)
                this.ap = packet;

            const ap = this.packetizeAP(depacketized);
            this.createRtpPackets(packet, ap, ret);
        }
        else if (nalType <= NAL_TYPE_RSV_IRAP_VCL23 || (nalType >= NAL_TYPE_VPS && nalType <= NAL_TYPE_SEI_SUFFIX)) {
            this.flushPendingFU(ret);

            if (this.shouldFilter(nalType)) {
                this.extraPackets--;
                return;
            }

            // Handle codec information
            if (nalType === NAL_TYPE_VPS) {
                this.extraPackets--;
                this.updateVps(packet.payload);
                return;
            }
            else if (nalType === NAL_TYPE_SPS) {
                this.extraPackets--;
                this.updateSps(packet.payload);
                return;
            }
            else if (nalType === NAL_TYPE_PPS) {
                this.extraPackets--;
                this.updatePps(packet.payload);
                return;
            }
            else if (nalType === NAL_TYPE_SEI_PREFIX || nalType === NAL_TYPE_SEI_SUFFIX) {
                this.extraPackets--;
                this.updateSei(packet.payload);
                return;
            }

            if (this.shouldFilter(nalType)) {
                this.extraPackets--;
                return;
            }

            // For IDR frames, send codec info first
            if (nalType === NAL_TYPE_IDR_W_RADL || nalType === NAL_TYPE_IDR_N_LP ||
                nalType === NAL_TYPE_BLA_W_LP || nalType === NAL_TYPE_BLA_W_RADL ||
                nalType === NAL_TYPE_BLA_N_LP) {
                this.maybeSendAPCodecInfo(packet, ret);
            }

            this.fragment(packet, ret);
        }
        else {
            this.console.error('unknown NAL unit type ' + nalType);
            this.extraPackets--;
        }

        return;
    }
}