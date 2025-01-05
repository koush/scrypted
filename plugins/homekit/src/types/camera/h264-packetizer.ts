import { isNextSequenceNumber, JitterBuffer, RtpPacket } from "./jitter-buffer";

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
export function depacketizeStapA(data: Buffer) {
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

export function splitH264NaluStartCode(data: Buffer) {
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

export interface H264CodecInfo {
    sps: Buffer;
    pps: Buffer;
    // Per ChatGPT excerpt below, resending the SEI may not the correct behavior when resending codec info,
    // as SEI payloads MAY only apply to a number or time range of frames.
    // I suspect that any encoders that send SEI messages that apply to a time range will send them regularly with SPS/PPS anyways.
    // The Supplemental Enhancement Information (SEI) payload in H.264 video compression typically applies to all following frames within a specific context. The SEI information is not frame-specific but rather context-specific. Here's how it works:
    //     1. **Context-Specific Information**: The SEI payload data often provides information that is valid for a range of frames or a portion of the video stream. For example, SEI messages may contain information about display orientation, buffering instructions, timing cues, or other metadata that applies to the video content as a whole or a specific segment of it.
    //     2. **Duration of Applicability**: SEI messages often include information about the "duration of applicability" or the time period for which the conveyed information is relevant. This duration information helps video decoders understand how long the SEI data should be applied to the frames.
    //     3. **Multiple SEI Messages**: The video stream can include multiple SEI messages, each with its own payload data and duration of applicability. As SEI messages are parsed, the decoder processes and applies the information according to the specified time range.
    //     4. **Continuous Application**: SEI information, once applied, typically remains in effect until a subsequent SEI message with different or canceling information is received. The decoder continues to use the information conveyed by the SEI message within its defined duration of applicability.
    //     5. **Dynamic Changes**: SEI messages can convey information about dynamic changes in the video stream, such as a change in display orientation or closed caption content. The decoder adjusts the display or handling of frames accordingly based on the SEI information received.
    //     In summary, SEI payload data is context-specific and often applies to multiple frames within a specified time range. It is not frame-specific but provides supplemental information that helps maintain synchronization, enhance accessibility, or optimize video playback over a period of time within the video stream. The specific behavior may vary depending on the type of SEI message and the video codec being used.
    sei?: Buffer;
}

export class H264Repacketizer {
    extraPackets = 0;
    fuaMax: number;
    pendingFuA: RtpPacket[];
    // the stapa packet that will be sent before an idr frame.
    stapa: RtpPacket;
    fuaMin: number;

    constructor(public console: Console, private maxPacketSize: number, public codecInfo?: H264CodecInfo, public jitterBuffer = new JitterBuffer(console, 4)) {
        this.setMaxPacketSize(maxPacketSize);
    }

    setMaxPacketSize(maxPacketSize: number) {
        this.maxPacketSize = maxPacketSize;
        // 12 is the rtp/srtp header size.
        this.fuaMax = maxPacketSize - FU_A_HEADER_SIZE;
        this.fuaMin = Math.round(maxPacketSize * .8);
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

    updateSei(sei: Buffer) {
        this.ensureCodecInfo();
        this.codecInfo.sei = sei;
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

        // when a stapa packet has a p frame inside it, it may exceed the max packet size.
        // it needs to be returned as is to be turned into a fua packet.
        if (counter === 0)
            return datas.shift();

        // a single nalu stapa is unnecessary, return the nalu itself.
        // this can happen when trying to packetize multiple nalus into a stapa
        // and the last nalu does not fit into the first stapa, and ends up in
        // a new stapa.
        if (counter === 1) {
            return payload[1];
        }

        payload.unshift(Buffer.from([stapHeader]));
        return Buffer.concat(payload);
    }

    packetizeStapA(datas: Buffer[]) {
        const ret: Buffer[] = [];
        while (datas.length) {
            const nalu = this.packetizeOneStapA(datas);
            if (nalu.length < this.maxPacketSize) {
                ret.push(nalu);
                continue;
            }
            const fuas = this.packetizeFuA(nalu);
            ret.push(...fuas);
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

        const getDefragmentedPendingFua = () => {
            const originalFragments = this.pendingFuA.map(packet => packet.payload.subarray(FU_A_HEADER_SIZE));
            originalFragments.unshift(originalNalHeader);
            const defragmented = Buffer.concat(originalFragments);
            return defragmented;
        }

        // have seen cameras that toss sps/pps/idr into a fua, delimited by start codes?
        // this probably is not compliant...
        // so the fua packet looks like:
        // sps | start code | pps | start code | idr
        if (originalNalType === NAL_TYPE_SPS) {
            const defragmented = getDefragmentedPendingFua();

            const splits = splitH264NaluStartCode(defragmented);
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
                        this.maybeSendStapACodecInfo(first, ret);

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
            while (this.pendingFuA.length) {
                const fua = this.pendingFuA[0];
                if (fua.payload.length > this.maxPacketSize || fua.payload.length < this.fuaMin)
                    break;
                this.pendingFuA.shift();
                ret.push(this.createPacket(fua, fua.payload, fua.header.marker));
            }

            if (!this.pendingFuA.length) {
                this.pendingFuA = undefined;
                return;
            }

            const first = this.pendingFuA[0];
            const last = this.pendingFuA[this.pendingFuA.length - 1];
            const hasFuStart = !!(first.payload[1] & 0x80);
            const hasFuEnd = !!(last.payload[1] & 0x40);

            const defragmented = getDefragmentedPendingFua();

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

    maybeSendStapACodecInfo(packet: RtpPacket, ret: RtpPacket[]) {
        if (this.stapa) {
            // stapa with codec information was sent recently, no need to send codec info.
            this.stapa = undefined;
            return;
        }

        if (!this.codecInfo?.sps || !this.codecInfo?.pps)
            return;

        const agg = [this.codecInfo.sps, this.codecInfo.pps];
        if (this.codecInfo?.sei)
            agg.push(this.codecInfo.sei);
        const aggregates = this.packetizeStapA(agg);
        if (aggregates.length !== 1) {
            this.console.error('expected only 1 packet for sps/pps stapa');
            return;
        }
        // this stapa only contains sps and pps (and no frame data), thus the marker bit should not be set.
        this.createRtpPackets(packet, aggregates, ret, false);
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

    repacketize<T extends RtpPacket>(packet: T): T[] {
        const ret: T[] = [];
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
            // ideally send the packets through as is from the upstream source.
            // refragment only if the incoming fua packet is larger than
            // the max packet size.

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

                this.pendingFuA = undefined;

                // if this is an idr frame, but no sps has been sent via a stapa, dummy one up.
                // the stream may not contain codec information in stapa or may be sending it
                // in separate sps/pps packets which is not supported by homekit.
                if (originalNalType === NAL_TYPE_IDR) {
                    this.maybeSendStapACodecInfo(packet, ret);
                }

            }
            else {
                if (this.pendingFuA) {
                    // check if packet were missing earlier from the previously queued fua packets.
                    // if so, don't queue the current packet.
                    // all further fua packets will continue to be dropped until a later fua start
                    // is received. the fua series up to the point of validity will then be flushed,
                    // although it will be incomplete, it is valid.
                    const last = this.pendingFuA[this.pendingFuA.length - 1];
                    if (!isNextSequenceNumber(last.header.sequenceNumber, packet.header.sequenceNumber)) {
                        this.console.error('fua packet missing. skipping refragmentation.', originalNalType);
                        return;
                    }
                }
            }

            if (!this.pendingFuA)
                this.pendingFuA = [];

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
                // retain a fua packet to validate subsequent fua packets.
                const retain = partial.pop();
                last.payload = retain.payload;
                this.pendingFuA = [last];
                ret.push(...partial);
            }
        }
        else if (nalType === NAL_TYPE_STAP_A) {
            this.flushPendingFuA(ret);

            let hasSps = false;
            let hasPps = false;

            // break the aggregated packet up to update codec information.
            const depacketized = depacketizeStapA(packet.payload);
            depacketized.forEach(payload => {
                    const nalType = payload[0] & 0x1F;
                    if (nalType === NAL_TYPE_SPS) {
                        hasSps = true;
                        this.updateSps(payload);
                    }
                    else if (nalType === NAL_TYPE_PPS) {
                        hasPps = true;
                        this.updatePps(payload);
                    }
                    else if (nalType === NAL_TYPE_SEI) {
                        this.updateSei(payload);
                    }
                    else if (nalType === NAL_TYPE_DELIMITER) {
                        // this is uncommon but has been seen. seems to be a no-op nalu.
                    }
                    else if (nalType === NAL_TYPE_NON_IDR) {
                        // this is uncommon but has been seen. oddly, on reolink this non-idr was sent
                        // after the codec information. so codec information can be changed between
                        // idr and non-idr? maybe it is not applied until next idr?
                    }
                    else if (nalType === NAL_TYPE_IDR) {
                        // this is uncommon but has been seen on tapo.
                        // i have no clue how they can fit an idr frame into a single packet stapa.
                    }
                    else if (nalType === 0) {
                        // nal delimiter or something. usually empty.
                    }
                    else {
                        this.console.warn('Skipped a stapa type.', nalType)
                    }
                });

            // log that a stapa with codec info was sent
            if (hasSps && hasPps)
                this.stapa = packet;

            const stapa = this.packetizeStapA(depacketized);
            this.createRtpPackets(packet, stapa, ret);
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
            else if (nalType === NAL_TYPE_SEI) {
                this.extraPackets--;
                this.updateSei(packet.payload);
                return;
            }

            if (this.shouldFilter(nalType)) {
                this.extraPackets--;
                return;
            }

            if (nalType === NAL_TYPE_IDR) {
                // if this is an idr frame, but no sps has been sent, dummy one up.
                // the stream may not contain sps.
                this.maybeSendStapACodecInfo(packet, ret);
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
