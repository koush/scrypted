import { RtpPacket } from "../../../../../external/werift/packages/rtp/src/rtp/rtp";

const PACKET_MAX = 1300;

const NAL_TYPE_FU_A = 28;
const NAL_TYPE_STAP_A = 24;

const NAL_HEADER_SIZE = 1;
const FU_A_HEADER_SIZE = 2;
const LENGTH_FIELD_SIZE = 2;
const STAP_A_HEADER_SIZE = NAL_HEADER_SIZE + LENGTH_FIELD_SIZE;

const FUA_MAX = PACKET_MAX - FU_A_HEADER_SIZE;

export class H264Repacketizer {
    extraPackets = 0;
    // don't think this queue is actually necessary if repacketizing rtp vs packetizing h264 nal.
    packetQueue: RtpPacket[];

    packetizeFuA(data: Buffer): Buffer[] {
        const initialNalType = data[0] & 0x1f;
        let actualStart: Buffer;
        let actualEnd: Buffer;
        if (initialNalType === 28) {
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
        const numPackets = Math.ceil(payloadSize / FUA_MAX);
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

    packetizeStapA(startPacket: RtpPacket) {
        const data = startPacket.payload;
        let counter = 0;
        let availableSize = PACKET_MAX - STAP_A_HEADER_SIZE;

        let stapHeader = NAL_TYPE_STAP_A | (data[0] & 0xE0);


        const payload: Buffer[] = [];

        let nalu = data;

        let packet: RtpPacket;
        while (nalu.length <= availableSize && counter < 9) {
            stapHeader |= nalu[0] & 0x80;

            const nri = nalu[0] & 0x60;

            if ((stapHeader & 0x60) < nri) {
                stapHeader = stapHeader & 0x9F | nri;
            }

            availableSize -= LENGTH_FIELD_SIZE + nalu.length;
            counter += 1;
            const packed = Buffer.alloc(2);
            packed.writeUInt16BE(nalu.length, 0);
            payload.push(packed, nalu);

            packet = this.packetQueue.shift();
            if (!packet)
                break;
        }

        if (counter !== 0 && packet)
            this.packetQueue.unshift(packet);

        if (counter <= 1)
            return startPacket.payload;

        return Buffer.concat([Buffer.from([stapHeader]), ...payload])
    }

    createPacket(rtp: RtpPacket, data: Buffer, marker: boolean, sequenceNumber?: number) {
        rtp.header.sequenceNumber = ((sequenceNumber || rtp.header.sequenceNumber) + this.extraPackets) % 0x10000;
        rtp.payload = data;
        rtp.header.marker = marker;
        return rtp.serialize();
    }

    packetizeQueue() {
        let marker = false;
        const ret: Buffer[] = [];
        while (this.packetQueue.length) {
            const packet = this.packetQueue.shift();
            const sequenceNumber = packet.header.sequenceNumber;
            if (packet.payload.length > PACKET_MAX) {
                const packets = this.packetizeFuA(packet.payload);
                packets.forEach((packetized, index) => {
                    if (index !== 0)
                        this.extraPackets++;
                    marker = index === packets.length - 1 && this.packetQueue.length === 0
                    ret.push(this.createPacket(packet, packetized, marker, sequenceNumber));
                });
            }
            else {
                marker = this.packetQueue.length === 0;
                ret.push(this.createPacket(packet, packet.payload, marker));
            }
        }
        return ret;
    }

    repacketize(packet: RtpPacket): Buffer[] {
        if (!this.packetQueue) {
            this.packetQueue = [packet];
            return;
        }

        if (packet.header.timestamp === this.packetQueue[0].header.timestamp) {
            this.packetQueue.push(packet);
            return;
        }

        const ret = this.packetizeQueue();
        this.packetQueue = [packet];
        return ret;
    }
}
