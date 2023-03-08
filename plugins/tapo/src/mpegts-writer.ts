// https://github.com/AlexxIT/go2rtc/blob/eff7b272933d288b6a509f824cbdd9ff88d14b65/pkg/mpegts/writer.go

import CRC32 from "crc-32";

export const StreamTypePCMATapo = 0x90
    ;

const PacketSize = 188;

const isUnitStart = 0x4000
const flagHasAdaptation = 0x20
const flagHasPayload = 0x10
const lenIsProgramTable = 0xB000
const tableFlags = 0xC1
const tableHeader = 0xE000
const tableLength = 0xF000

const patPID = 0
const patTableID = 0
const patTableExtID = 1


const pmtPID = 18
const pmtTableID = 2
const pmtTableExtID = 1

const SyncByte = 0x47;

const pesHeaderSize = PacketSize - 18
function byte(b: number) {
    return b & 0xFF;
}

function uint16(b: number) {
    return b & 0xFFFF;
}

function uint32(b: number) {
    return b & 0xFFFFFFFF;
}

export class MpegTSWriter {
    b: Buffer[] = [];
    m: number;

    pid: number[] = [];
    counter: number[] = [];
    streamType: number[] = []
    timestamp: number[] = [];

    ResetBytes() {
        const concat = Buffer.concat(this.b);
        if (concat.length % PacketSize)
            throw new Error('invalid packet size')
        this.b = [];
        return concat;
    }

    AddPES(pid: number, streamType: number) {
        this.pid.push(pid)
        this.streamType.push(streamType)
        this.counter.push(0)
        this.timestamp.push(0)
    }

    WriteByte(b: number) {
        this.b.push(Buffer.from([b]));
    }

    WriteUint16(i: number) {
        this.WriteBytes(byte(i >> 8), byte(i))
    }

    WriteTime(t: number) {
        const onlyPTS = 0x20
        // [>>32 <<3] [>>24 <<2] [>>16 <<2] [>>8 <<1] [<<1]
        const b = Buffer.from([onlyPTS | byte(t >> 29) | 1, byte(t >> 22), byte(t >> 14) | 1, byte(t >> 7), byte(t << 1) | 1])
        this.b.push(b);
    }

    WriteBytes(...b: number[]) {
        this.b.push(Buffer.from(b));
    }

    WriteBuffer(b: Buffer) {
        this.b.push(b);
    }

    MarkChecksum() {
        const concat = Buffer.concat(this.b);
        this.m = concat.length;
    }

    WriteChecksum() {
        const concat = Buffer.concat(this.b);
        const check = concat.subarray(this.m);

        const crc = CRC32.buf(check);
        this.WriteBytes(byte(crc), byte(crc >> 8), byte(crc >> 16), byte(crc >> 24))
    }

    FinishPacket() {
        const concat = Buffer.concat(this.b);
        const n = concat.length % PacketSize;
        if (n) {
            const empty = Buffer.alloc(PacketSize - n);
            this.b.push(empty);
        }
    }

    WritePAT() {
        this.WriteByte(SyncByte)
        this.WriteUint16(isUnitStart | patPID) // PAT PID
        this.WriteByte(flagHasPayload)         // flags...

        this.WriteByte(0) // Pointer field

        this.MarkChecksum()
        this.WriteByte(patTableID)               // Table ID
        this.WriteUint16(lenIsProgramTable | 13) // Section length
        this.WriteUint16(patTableExtID)          // Table ID extension
        this.WriteByte(tableFlags)               // flags...
        this.WriteByte(0)                        // Section number
        this.WriteByte(0)                        // Last section number

        this.WriteUint16(1) // Program num (usual 1)
        this.WriteUint16(tableHeader + pmtPID)

        this.WriteChecksum()

        this.FinishPacket()
    }

    WritePMT() {
        this.WriteByte(SyncByte)
        this.WriteUint16(isUnitStart | pmtPID) // PMT PID
        this.WriteByte(flagHasPayload)         // flags...

        this.WriteByte(0) // Pointer field

        const tableLen = uint16(13 + this.pid.length * 5);

        this.MarkChecksum()
        this.WriteByte(pmtTableID)                     // Table ID
        this.WriteUint16(lenIsProgramTable | tableLen) // Section length
        this.WriteUint16(pmtTableExtID)                // Table ID extension
        this.WriteByte(tableFlags)                     // flags...
        this.WriteByte(0)                              // Section number
        this.WriteByte(0)                              // Last section number

        this.WriteUint16(tableHeader | this.pid[0]) // PID
        this.WriteUint16(tableLength | 0)        // Info length

        for (let i = 0; i < this.pid.length; i++) {
            const pid = this.pid[i];
            this.WriteByte(this.streamType[i])
            this.WriteUint16(tableHeader | pid) // PID
            this.WriteUint16(tableLength | 0)   // Info len
        }

        this.WriteChecksum()

        this.FinishPacket()
    }

    WritePES(pid: number, streamID: number, payload: Buffer) {
        this.WriteByte(SyncByte)
        this.WriteUint16(isUnitStart | pid)

        // check if payload lower then max first packet size
        if (payload.length < PacketSize - 18) {
            this.WriteByte(flagHasAdaptation | flagHasPayload)

            // for 183 payload will be zero
            const adSize = PacketSize - 18 - 1 - byte(payload.length)
            this.WriteByte(adSize)
            this.WriteBuffer(Buffer.alloc(adSize))
        } else {
            this.WriteByte(flagHasPayload)
        }

        this.WriteByte(0)
        this.WriteByte(0)
        this.WriteByte(1)

        this.WriteByte(streamID)
        this.WriteUint16(uint16(8 + payload.length))

        this.WriteByte(0x80)
        this.WriteByte(0x80) // only PTS
        this.WriteByte(5)    // optional size

        switch (this.streamType[0]) {
            case StreamTypePCMATapo:
                this.timestamp[0] += uint32(payload.length * 45 / 8)
        }

        this.WriteTime(this.timestamp[0])

        if (payload.length < PacketSize - 18) {
            this.WriteBuffer(payload)
            return
        }

        this.WriteBuffer(payload.subarray(0, pesHeaderSize));

        payload = payload.subarray(pesHeaderSize);
        let counter: number

        while (true) {
            counter++

            if (payload.length > PacketSize - 4) {
                // payload more then maximum size
                this.WriteByte(SyncByte)
                this.WriteUint16(pid)
                this.WriteByte(flagHasPayload | counter & 0xF)
                this.WriteBuffer(payload.subarray(0, PacketSize - 4));

                payload = payload.subarray(PacketSize - 4)
            } else if (payload.length === PacketSize - 4) {
                // payload equal maximum size (last packet)
                this.WriteByte(SyncByte)
                this.WriteUint16(pid)
                this.WriteByte(flagHasPayload | counter & 0xF)
                this.WriteBuffer(payload)

                break
            } else {
                // payload lower than maximum size (last packet)
                this.WriteByte(SyncByte)
                this.WriteUint16(pid)
                this.WriteByte(flagHasAdaptation | flagHasPayload | counter & 0xF)

                // for 183 payload will be zero
                const adSize = PacketSize - 4 - 1 - byte(payload.length)
                this.WriteByte(adSize)
                this.WriteBuffer(Buffer.alloc(adSize))

                this.WriteBuffer(payload)

                break
            }
        }
    }
}
