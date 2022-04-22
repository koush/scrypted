import { RtpPacket } from "../../../../../external/werift/packages/rtp/src/rtp/rtp";

const NAL_TYPE_STAP_A = 24;
const NAL_TYPE_FU_A = 28;

const NAL_HEADER_SIZE = 1;
const FU_A_HEADER_SIZE = 2;
const LENGTH_FIELD_SIZE = 2;
const STAP_A_HEADER_SIZE = NAL_HEADER_SIZE + LENGTH_FIELD_SIZE;

export class H264Repacketizer {
    extraPackets = 0;
    fuaMax: number;

    constructor(public maxPacketSize: number) {
        // 12 is the rtp/srtp header size.
        this.fuaMax = maxPacketSize - FU_A_HEADER_SIZE;;
    }

    // a fragmentation unit (fua) is a NAL unit broken into multiple fragments.
    packetizeFuA(data: Buffer): Buffer[] {
        // handle both normal packets and fua packets.
        // a fua packet can be fragmented easily into smaller packets, as
        // it is already a fragment, and splitting segments is
        // trivial.

        const initialNalType = data[0] & 0x1f;
        let actualStart: Buffer;
        let actualEnd: Buffer;

        if (initialNalType === NAL_TYPE_FU_A) {
            const fnri = data[0] & (0x80 | 0x60);
            const originalNalType = data[1] & 0x1f;
            const isFuStart = !!(data[1] & 0x80);
            const isFuEnd = !!(data[1] & 0x40);
            const isFuMiddle = !isFuStart && !isFuEnd;

            const originalNalHeader = Buffer.from([fnri | originalNalType]);
            data = Buffer.concat([originalNalHeader, data.subarray(FU_A_HEADER_SIZE)]);

            const fuIndicator = fnri | NAL_TYPE_FU_A;

            const fuHeaderMiddle = Buffer.from([fuIndicator, originalNalType]);

            if (isFuStart) {
                actualEnd = fuHeaderMiddle;
            }
            else if (isFuEnd) {
                actualStart = fuHeaderMiddle;
            }
            else if (isFuMiddle) {
                actualStart = fuHeaderMiddle;
                actualEnd = fuHeaderMiddle;
            }
        }

        const payloadSize = data.length - NAL_HEADER_SIZE;
        const numPackets = Math.ceil(payloadSize / this.fuaMax);
        let numLargerPackets = payloadSize % numPackets;
        const packageSize = Math.floor(payloadSize / numPackets);

        const fnri = data[0] & (0x80 | 0x60);
        const nal = data[0] & 0x1F;

        const fuIndicator = fnri | NAL_TYPE_FU_A;

        const fuHeaderEnd = actualEnd || Buffer.from([fuIndicator, nal | 0x40]);
        const fuHeaderMiddle = Buffer.from([fuIndicator, nal]);
        const fuHeaderStart = actualStart || Buffer.from([fuIndicator, nal | 0x80]);
        let fuHeader = fuHeaderStart;

        const packages: Buffer[] = [];
        let offset = NAL_HEADER_SIZE;

        while (offset < data.length) {
            let payload: Buffer;
            if (numLargerPackets > 0) {
                numLargerPackets -= 1;
                payload = data.subarray(offset, offset + packageSize + 1);
                offset += packageSize + 1;
            }
            else {
                payload = data.subarray(offset, offset + packageSize);
                offset += packageSize;
            }

            if (offset === data.length) {
                fuHeader = fuHeaderEnd;
            }

            packages.push(Buffer.concat([fuHeader, payload]));

            fuHeader = fuHeaderMiddle;
        }

        return packages;
    }

    // a stap a packet is a packet that aggregates multiple nals
    depacketizeStapA(data: Buffer) {
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

    packetizeOneStapA(datas: Buffer[]): Buffer {
        const payload: Buffer[] = [];

        if (!datas.length)
            throw new Error('packetizeOneStapA requires at least one NAL');

        let counter = 0;
        let availableSize = this.maxPacketSize - STAP_A_HEADER_SIZE;

        let stapHeader = NAL_TYPE_STAP_A | (datas[0][0] & 0xE0);

        while (datas.length && datas[0].length + LENGTH_FIELD_SIZE <= availableSize && counter < 9) {
            const nalu = datas.shift();

            stapHeader |= nalu[0] & 0x80;

            const nri = nalu[0] & 0x60;
            if ((stapHeader & 0x60) < nri)
                stapHeader = stapHeader & 0x9F | nri;

            availableSize -= LENGTH_FIELD_SIZE + nalu.length;
            counter += 1;
            const packed = Buffer.alloc(2);
            packed.writeUInt16BE(nalu.length, 0);
            payload.push(packed, nalu);
        }

        // is this possible?
        if (counter === 0) {
            console.warn('stap a packet is too large. this may be a bug.');
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

    createPacket(rtp: RtpPacket, data: Buffer, marker: boolean, sequenceNumber?: number) {
        rtp.header.sequenceNumber = ((sequenceNumber || rtp.header.sequenceNumber) + this.extraPackets) % 0x10000;
        rtp.payload = data;
        rtp.header.marker = marker;
        const ret = rtp.serialize();
        if (data.length > this.maxPacketSize)
            console.warn('packet exceeded max packet size. this may a bug.');
        return ret;
    }

    repacketize(packet: RtpPacket): Buffer[] {
        const ret: Buffer[] = [];
        const sequenceNumber = packet.header.sequenceNumber;
        const hadMarker = packet.header.marker;

        if (packet.payload.length > this.maxPacketSize) {
            const nalType = packet.payload[0] & 0x1F;
            if (nalType === NAL_TYPE_STAP_A) {
                // break the aggregated packet up and send it.
                const depacketized = this.depacketizeStapA(packet.payload);
                const packets = this.packetizeStapA(depacketized);
                packets.forEach((packetized, index) => {
                    if (index !== 0)
                        this.extraPackets++;
                    const marker = hadMarker && index === packets.length - 1;
                    ret.push(this.createPacket(packet, packetized, marker, sequenceNumber));
                });
            }
            else if ((nalType >= 1 && nalType < 24) || nalType === NAL_TYPE_FU_A) {
                const fragments = this.packetizeFuA(packet.payload);
                fragments.forEach((packetized, index) => {
                    if (index !== 0)
                        this.extraPackets++;
                    const marker = hadMarker && index === fragments.length - 1;
                    ret.push(this.createPacket(packet, packetized, marker, sequenceNumber));
                });
            }
            else {
                throw new Error('unknown nal unit type ' + nalType);
            }
        }
        else {
            // can send this packet as is!
            ret.push(this.createPacket(packet, packet.payload, packet.header.marker));
        }

        return ret;
    }
}
