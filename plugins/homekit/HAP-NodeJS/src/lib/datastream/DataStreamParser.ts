import * as uuid from '../util/uuid'
import * as hapCrypto from "../util/hapCrypto"
import assert from 'assert';
import createDebug from 'debug';

// welcome to hell :)
// in this file lies madness and frustration. and its not only about HDS. also JavaScript is hell

const debug = createDebug("HAP-NodeJS:DataStream:Parser");

class Magics {
    static readonly TERMINATOR = { type: "terminator" };
}

export class ValueWrapper<T> { // basically used to differentiate between different sized integers when encoding (to force certain encoding)

    value: T;

    constructor(value: T) {
        this.value = value;
    }

    public equals(obj: ValueWrapper<T>) : boolean {
        return this.constructor.name === obj.constructor.name && obj.value === this.value;
    }

}

export class Int8 extends ValueWrapper<number> {}
export class Int16 extends ValueWrapper<number> {}
export class Int32 extends ValueWrapper<number> {}
export class Int64 extends ValueWrapper<number> {}
export class Float32 extends ValueWrapper<number> {}
export class Float64 extends ValueWrapper<number> {}
export class SecondsSince2001 extends ValueWrapper<number> {}
export class UUID extends ValueWrapper<string> {

    constructor(value: string) {
        assert(uuid.isValid(value), "invalid uuid format");
        super(value);
    }

}

export const enum DataFormatTags {
    INVALID = 0x00,

    TRUE = 0x01,
    FALSE = 0x02,

    TERMINATOR = 0x03,
    NULL = 0x04,
    UUID = 0x05,
    DATE = 0x06,

    INTEGER_MINUS_ONE = 0x07,
    INTEGER_RANGE_START_0 = 0x08,
    INTEGER_RANGE_STOP_39 = 0x2E,
    INT8 = 0x30,
    INT16LE = 0x31,
    INT32LE = 0x32,
    INT64LE = 0x33,

    FLOAT32LE = 0x35,
    FLOAT64LE = 0x36,

    UTF8_LENGTH_START = 0x40,
    UTF8_LENGTH_STOP = 0x60,
    UTF8_LENGTH8 = 0x61,
    UTF8_LENGTH16LE = 0x62,
    UTF8_LENGTH32LE = 0x63,
    UTF8_LENGTH64LE = 0x64,
    UTF8_NULL_TERMINATED = 0x6F,

    DATA_LENGTH_START = 0x70,
    DATA_LENGTH_STOP = 0x90,
    DATA_LENGTH8 = 0x91,
    DATA_LENGTH16LE = 0x92,
    DATA_LENGTH32LE = 0x93,
    DATA_LENGTH64LE = 0x94,
    DATA_TERMINATED = 0x9F,

    COMPRESSION_START = 0xA0,
    COMPRESSION_STOP = 0xCF,

    ARRAY_LENGTH_START = 0xD0,
    ARRAY_LENGTH_STOP = 0xDE,
    ARRAY_TERMINATED = 0xDF,

    DICTIONARY_LENGTH_START = 0xE0,
    DICTIONARY_LENGTH_STOP = 0xEE,
    DICTIONARY_TERMINATED = 0xEF,
}

export class DataStreamParser {
    public static decode(buffer: DataStreamReader): any {
        const tag = buffer.readTag();

        if (tag === DataFormatTags.INVALID) {
            throw new Error("HDSDecoder: zero tag detected on index " + buffer.readerIndex);
        } else if (tag === DataFormatTags.TRUE) {
            return buffer.readTrue();
        } else if (tag === DataFormatTags.FALSE) {
            return buffer.readFalse();
        } else if (tag === DataFormatTags.TERMINATOR) {
            return Magics.TERMINATOR;
        } else if (tag === DataFormatTags.NULL) {
            return null;
        } else if (tag === DataFormatTags.UUID) {
            return buffer.readUUID();
        } else if (tag === DataFormatTags.DATE) {
            return buffer.readSecondsSince2001_01_01();
        } else if (tag === DataFormatTags.INTEGER_MINUS_ONE) {
            return buffer.readNegOne();
        } else if (tag >= DataFormatTags.INTEGER_RANGE_START_0 && tag <= DataFormatTags.INTEGER_RANGE_STOP_39) {
            return buffer.readIntRange(tag); // integer values from 0-39
        } else if (tag === DataFormatTags.INT8) {
            return buffer.readInt8();
        } else if (tag === DataFormatTags.INT16LE) {
            return buffer.readInt16LE();
        } else if (tag === DataFormatTags.INT32LE) {
            return buffer.readInt32LE();
        } else if (tag === DataFormatTags.INT64LE) {
            return buffer.readInt64LE();
        } else if (tag === DataFormatTags.FLOAT32LE) {
            return buffer.readFloat32LE();
        } else if (tag === DataFormatTags.FLOAT64LE) {
            return buffer.readFloat64LE();
        } else if (tag >= DataFormatTags.UTF8_LENGTH_START && tag <= DataFormatTags.UTF8_LENGTH_STOP) {
            const length = tag - DataFormatTags.UTF8_LENGTH_START;
            return buffer.readUTF8(length);
        } else if (tag === DataFormatTags.UTF8_LENGTH8) {
            return buffer.readUTF8_Length8();
        } else if (tag === DataFormatTags.UTF8_LENGTH16LE) {
            return buffer.readUTF8_Length16LE();
        } else if (tag === DataFormatTags.UTF8_LENGTH32LE) {
            return buffer.readUTF8_Length32LE();
        } else if (tag === DataFormatTags.UTF8_LENGTH64LE) {
            return buffer.readUTF8_Length64LE();
        } else if (tag === DataFormatTags.UTF8_NULL_TERMINATED) {
            return buffer.readUTF8_NULL_terminated();
        } else if (tag >= DataFormatTags.DATA_LENGTH_START && tag <= DataFormatTags.DATA_LENGTH_STOP) {
            const length = tag - DataFormatTags.DATA_LENGTH_START;
            buffer.readData(length);
        } else if (tag === DataFormatTags.DATA_LENGTH8) {
            return buffer.readData_Length8();
        } else if (tag === DataFormatTags.DATA_LENGTH16LE) {
            return buffer.readData_Length16LE();
        } else if (tag === DataFormatTags.DATA_LENGTH32LE) {
            return buffer.readData_Length32LE();
        } else if (tag === DataFormatTags.DATA_LENGTH64LE) {
            return buffer.readData_Length64LE();
        } else if (tag === DataFormatTags.DATA_TERMINATED) {
            return buffer.readData_terminated();
        } else if (tag >= DataFormatTags.COMPRESSION_START && tag <= DataFormatTags.COMPRESSION_STOP) {
            const index = tag - DataFormatTags.COMPRESSION_START;
            return buffer.decompressData(index);
        } else if (tag >= DataFormatTags.ARRAY_LENGTH_START && tag <= DataFormatTags.ARRAY_LENGTH_STOP) {
            const length = tag - DataFormatTags.ARRAY_LENGTH_START;
            const array = [];

            for (let i = 0; i < length; i++) {
                array.push(this.decode(buffer));
            }

            return array;
        } else if (tag === DataFormatTags.ARRAY_TERMINATED) {
            const array = [];

            let element;
            while ((element = this.decode(buffer)) != Magics.TERMINATOR) {
                array.push(element);
            }

            return array;
        } else if (tag >= DataFormatTags.DICTIONARY_LENGTH_START && tag <= DataFormatTags.DICTIONARY_LENGTH_STOP) {
            const length = tag - DataFormatTags.DICTIONARY_LENGTH_START;
            const dictionary: Record<any, any> = {};

            for (let i = 0; i < length; i++) {
                const key = this.decode(buffer);
                dictionary[key] = this.decode(buffer);
            }

            return dictionary;
        } else if (tag === DataFormatTags.DICTIONARY_TERMINATED) {
            const dictionary: Record<any, any> = {};

            let key;
            while ((key = this.decode(buffer)) != Magics.TERMINATOR) {
                dictionary[key] = this.decode(buffer); // decode value
            }

            return dictionary;
        } else {
            throw new Error("HDSDecoder: encountered unknown tag on index " + buffer.readerIndex + ": " + tag.toString(16));
        }
    }

    public static encode(data: any, buffer: DataStreamWriter): void {
        if (data === undefined) {
            throw new Error("HDSEncoder: cannot encode undefined");
        }

        if (data === null) {
            buffer.writeTag(DataFormatTags.NULL);
            return;
        }

        switch (typeof data) {
            case "boolean":
                if (data) {
                    buffer.writeTrue();
                } else {
                    buffer.writeFalse();
                }
                break;
            case "number":
                if (Number.isInteger(data)) {
                    buffer.writeNumber(data);
                } else {
                    buffer.writeFloat64LE(new Float64(data));
                }
                break;
            case "string":
                buffer.writeUTF8(data);
                break;
            case "object":
                if (Array.isArray(data)) {
                    const length = data.length;

                    if (length <= 12) {
                        buffer.writeTag(DataFormatTags.ARRAY_LENGTH_START + length);
                    } else {
                        buffer.writeTag(DataFormatTags.ARRAY_TERMINATED);
                    }

                    data.forEach(element => {
                        this.encode(element, buffer);
                    });

                    if (length > 12) {
                        buffer.writeTag(DataFormatTags.TERMINATOR);
                    }
                } else if (data instanceof ValueWrapper) {
                    if (data instanceof Int8) {
                        buffer.writeInt8(data);
                    } else if (data instanceof Int16) {
                        buffer.writeInt16LE(data);
                    } else if (data instanceof Int32) {
                        buffer.writeInt32LE(data);
                    } else if (data instanceof Int64) {
                        buffer.writeInt64LE(data);
                    } else if (data instanceof Float32) {
                        buffer.writeFloat32LE(data);
                    } else if (data instanceof Float64) {
                        buffer.writeFloat64LE(data);
                    } else if (data instanceof SecondsSince2001) {
                        buffer.writeSecondsSince2001_01_01(data);
                    } else if (data instanceof UUID) {
                        buffer.writeUUID(data.value);
                    } else {
                        throw new Error("Unknown wrapped object 'ValueWrapper' of class " + data.constructor.name);
                    }
                } else if (data instanceof Buffer) {
                    buffer.writeData(data);
                } else { // object is treated as dictionary
                    const entries = Object.entries(data);

                    if (entries.length <= 14) {
                        buffer.writeTag(DataFormatTags.DICTIONARY_LENGTH_START + entries.length);
                    } else {
                        buffer.writeTag(DataFormatTags.DICTIONARY_TERMINATED);
                    }

                    entries.forEach(entry => {
                        this.encode(entry[0], buffer); // encode key
                        this.encode(entry[1], buffer); // encode value
                    });

                    if (entries.length > 14) {
                        buffer.writeTag(DataFormatTags.TERMINATOR);
                    }
                }
                break;
            default:
                throw new Error("HDSEncoder: no idea how to encode value of type '" + (typeof data) +"': " + data);
        }
    }
}

export class DataStreamReader {

    private readonly data: Buffer;
    readerIndex: number;

    private trackedCompressedData: any[] = [];

    constructor(data: Buffer) {
        this.data = data;
        this.readerIndex = 0;
    }

    finished() {
        if (this.readerIndex < this.data.length) {
            const remainingHex = this.data.slice(this.readerIndex, this.data.length).toString("hex");
            debug("WARNING Finished reading HDS stream, but there are still %d bytes remaining () %s", this.data.length - this.readerIndex, remainingHex);
        }
    }

    decompressData(index: number) {
        if (index >= this.trackedCompressedData.length) {
            throw new Error("HDSDecoder: Tried decompression of data for an index out of range (index " + index + " and got " + this.trackedCompressedData.length + " elements)");
        }

        return this.trackedCompressedData[index];
    }

    private trackData(data: any) {
        this.trackedCompressedData.push(data);
        return data;
    }

    private ensureLength(bytes: number) {
        if (this.readerIndex + bytes > this.data.length) {
            const remaining = this.data.length - this.readerIndex;
            throw new Error("HDSDecoder: End of data stream. Tried reading " + bytes + " bytes however got only " + remaining + " remaining!");
        }
    }

    readTag() {
        this.ensureLength(1);
        return this.data.readUInt8(this.readerIndex++);
    }

    readTrue() {
        return this.trackData(true); // do those tag encoded values get cached?
    }

    readFalse() {
        return this.trackData(false);
    }

    readNegOne() {
        return this.trackData(-1);
    }

    readIntRange(tag: number) {
        return this.trackData(tag - DataFormatTags.INTEGER_RANGE_START_0); // integer values from 0-39
    }

    readInt8() {
        this.ensureLength(1);
        return this.trackData(this.data.readInt8(this.readerIndex++));
    }

    readInt16LE() {
        this.ensureLength(2);
        const value = this.data.readInt16LE(this.readerIndex);
        this.readerIndex += 2;
        return this.trackData(value);
    }

    readInt32LE() {
        this.ensureLength(4);
        const value = this.data.readInt32LE(this.readerIndex);
        this.readerIndex += 4;
        return this.trackData(value);
    }

    readInt64LE() {
        this.ensureLength(8);

        const low = this.data.readInt32LE(this.readerIndex);
        let value = this.data.readInt32LE(this.readerIndex + 4) * 0x100000000 + low;
        if (low < 0) {
            value += 0x100000000;
        }

        this.readerIndex += 8;
        return this.trackData(value);
    }

    readFloat32LE() {
        this.ensureLength(4);
        const value = this.data.readFloatLE(this.readerIndex);
        this.readerIndex += 4;
        return this.trackData(value);
    }

    readFloat64LE() {
        this.ensureLength(8);
        const value = this.data.readDoubleLE(this.readerIndex);
        return this.trackData(value);
    }

    private readLength8() {
        this.ensureLength(1);
        return this.data.readUInt8(this.readerIndex++);
    }

    private readLength16LE() {
        this.ensureLength(2);
        const value = this.data.readUInt16LE(this.readerIndex);
        this.readerIndex += 2;
        return value;
    }

    private readLength32LE() {
        this.ensureLength(4);
        const value = this.data.readUInt32LE(this.readerIndex);
        this.readerIndex += 4;
        return value;
    }

    private readLength64LE() {
        this.ensureLength(8);

        const low = this.data.readUInt32LE(this.readerIndex);
        const value = this.data.readUInt32LE(this.readerIndex + 4) * 0x100000000 + low;

        this.readerIndex += 8;
        return value;
    }

    readUTF8(length: number) {
        this.ensureLength(length);
        const value = this.data.toString('utf8', this.readerIndex, this.readerIndex + length);
        this.readerIndex += length;
        return this.trackData(value);
    }

    readUTF8_Length8() {
        const length = this.readLength8();
        return this.readUTF8(length);
    }

    readUTF8_Length16LE() {
        const length = this.readLength16LE();
        return this.readUTF8(length);
    }

    readUTF8_Length32LE() {
        const length = this.readLength32LE();
        return this.readUTF8(length);
    }

    readUTF8_Length64LE() {
        const length = this.readLength64LE();
        return this.readUTF8(length);
    }

    readUTF8_NULL_terminated() {
        let offset = this.readerIndex;
        let nextByte;

        for (;;) {
            nextByte = this.data[offset];

            if (nextByte === undefined) {
                throw new Error("HDSDecoder: Reached end of data stream while reading NUL terminated string!");
            } else  if (nextByte === 0) {
                break;
            } else {
                offset++;
            }
        }

        const value = this.data.toString('utf8', this.readerIndex, offset);
        this.readerIndex = offset + 1;
        return this.trackData(value);
    }

    readData(length: number) {
        this.ensureLength(length);
        const value = this.data.slice(this.readerIndex, this.readerIndex + length);
        this.readerIndex += length;

        return this.trackData(value);
    }

    readData_Length8() {
        const length = this.readLength8();
        return this.readData(length);
    }

    readData_Length16LE() {
        const length = this.readLength16LE();
        return this.readData(length);
    }

    readData_Length32LE() {
        const length = this.readLength32LE();
        return this.readData(length);
    }

    readData_Length64LE() {
        const length = this.readLength64LE();
        return this.readData(length);
    }

    readData_terminated() {
        let offset = this.readerIndex;
        let nextByte;

        for (;;) {
            nextByte = this.data[offset];

            if (nextByte === undefined) {
                throw new Error("HDSDecoder: Reached end of data stream while reading terminated data!");
            } else  if (nextByte === DataFormatTags.TERMINATOR) {
                break;
            } else {
                offset++;
            }
        }

        const value = this.data.slice(this.readerIndex, offset);
        this.readerIndex = offset + 1;
        return this.trackData(value);
    }

    readSecondsSince2001_01_01() {
        // second since 2001-01-01 00:00:00
        return this.readFloat64LE();
    }

    readUUID() { // big endian
        this.ensureLength(16);
        const value = uuid.unparse(this.data, this.readerIndex);
        this.readerIndex += 16;
        return this.trackData(value);
    }

}

class WrittenDataList { // wrapper class since javascript doesn't really have a way to override === operator

    private writtenData: any[] = [];

    push(data: any) {
        this.writtenData.push(data);
    }

    indexOf(data: any) {
        for (let i = 0; i < this.writtenData.length; i++) {
            const data0 = this.writtenData[i];

            if (data === data0) {
                return i;
            }

            if (data instanceof ValueWrapper && data0 instanceof ValueWrapper) {
                if (data.equals(data0)) {
                    return i;
                }
            }
        }

        return -1;
    }

}

export class DataStreamWriter {

    private static readonly chunkSize = 128; // seems to be a good default

    private data: Buffer;
    private writerIndex: number;

    private writtenData = new WrittenDataList();

    constructor() {
        this.data = Buffer.alloc(DataStreamWriter.chunkSize);
        this.writerIndex = 0;
    }

    length() {
        return this.writerIndex; // since writerIndex points to the next FREE index it also represents the length
    }

    getData() {
        return this.data.slice(0, this.writerIndex);
    }

    private ensureLength(bytes: number) {
        const neededBytes = (this.writerIndex + bytes) - this.data.length;
        if (neededBytes > 0) {
            const chunks = Math.ceil(neededBytes / DataStreamWriter.chunkSize);

            // don't know if it's best for performance to immediately concatenate the buffers. That way it's
            // the easiest way to handle writing though.
            this.data = Buffer.concat([this.data, Buffer.alloc(chunks * DataStreamWriter.chunkSize)]);
        }
    }

    private compressDataIfPossible(data: any): boolean {
        const index = this.writtenData.indexOf(data);
        if (index < 0) {
            // data is not present yet
            this.writtenData.push(data);
            return false;
        } else if (index <= DataFormatTags.COMPRESSION_STOP - DataFormatTags.COMPRESSION_START) {
            // data was already written and the index is in the applicable range => shorten the payload
            this.writeTag(DataFormatTags.COMPRESSION_START + index);
            return true;
        }

        return false;
    }

    writeTag(tag: DataFormatTags) {
        this.ensureLength(1);
        this.data.writeUInt8(tag, this.writerIndex++);
    }

    writeTrue() {
        this.writeTag(DataFormatTags.TRUE);
    }

    writeFalse() {
        this.writeTag(DataFormatTags.FALSE);
    }

    writeNumber(number: number) {
        if (number === -1) {
            this.writeTag(DataFormatTags.INTEGER_MINUS_ONE);
        } else if (number >= 0 && number <= 39) {
            this.writeTag(DataFormatTags.INTEGER_RANGE_START_0 + number);
        } else if (number >= -128 && number <= 127) {
            this.writeInt8(new Int8(number));
        } else if (number >= -32768 && number <= 32767) {
            this.writeInt16LE(new Int16(number));
        } else if (number >= -2147483648 && number <= -2147483648) {
            this.writeInt32LE(new Int32(number));
        } else if (number >= Number.MIN_SAFE_INTEGER && number <= Number.MAX_SAFE_INTEGER) { // use correct uin64 restriction when we convert to bigint
            this.writeInt64LE(new Int64(number));
        } else {
            throw new Error("Tried writing unrepresentable number (" + number + ")");
        }
    }

    writeInt8(int8: Int8) {
        if (this.compressDataIfPossible(int8)) {
            return;
        }

        this.ensureLength(2);
        this.writeTag(DataFormatTags.INT8);
        this.data.writeInt8(int8.value, this.writerIndex++);
    }

    writeInt16LE(int16: Int16) {
        if (this.compressDataIfPossible(int16)) {
            return;
        }

        this.ensureLength(3);
        this.writeTag(DataFormatTags.INT16LE);
        this.data.writeInt16LE(int16.value, this.writerIndex);
        this.writerIndex += 2;
    }

    writeInt32LE(int32: Int32) {
        if (this.compressDataIfPossible(int32)) {
            return;
        }

        this.ensureLength(5);
        this.writeTag(DataFormatTags.INT32LE);
        this.data.writeInt32LE(int32.value, this.writerIndex);
        this.writerIndex += 4;
    }

    writeInt64LE(int64: Int64) {
        if (this.compressDataIfPossible(int64)) {
            return;
        }

        this.ensureLength(9);
        this.writeTag(DataFormatTags.INT64LE);
        this.data.writeUInt32LE(int64.value, this.writerIndex);// TODO correctly implement int64; currently it's basically an int32
        this.data.writeUInt32LE(0, this.writerIndex + 4);
        this.writerIndex += 8;
    }

    writeFloat32LE(float32: Float32) {
        if (this.compressDataIfPossible(float32)) {
            return;
        }

        this.ensureLength(5);
        this.writeTag(DataFormatTags.FLOAT32LE);
        this.data.writeFloatLE(float32.value, this.writerIndex);
        this.writerIndex += 4;
    }

    writeFloat64LE(float64: Float64) {
        if (this.compressDataIfPossible(float64)) {
            return;
        }

        this.ensureLength(9);
        this.writeTag(DataFormatTags.FLOAT64LE);
        this.data.writeDoubleLE(float64.value, this.writerIndex);
        this.writerIndex += 8;
    }

    private writeLength8(length: number) {
        this.ensureLength(1);
        this.data.writeUInt8(length, this.writerIndex++);
    }

    private writeLength16LE(length: number) {
        this.ensureLength(2);
        this.data.writeUInt16LE(length, this.writerIndex);
        this.writerIndex += 2;
    }

    private writeLength32LE(length: number) {
        this.ensureLength(4);
        this.data.writeUInt32LE(length, this.writerIndex);
        this.writerIndex += 4;
    }

    private writeLength64LE(length: number) {
        this.ensureLength(8);
        hapCrypto.writeUInt64LE(length, this.data, this.writerIndex);
        this.writerIndex += 8;
    }

    writeUTF8(utf8: string) {
        if (this.compressDataIfPossible(utf8)) {
            return;
        }

        const length = Buffer.byteLength(utf8);
        if (length <= 32) {
            this.ensureLength(1 + length);
            this.writeTag(DataFormatTags.UTF8_LENGTH_START + utf8.length);
            this._writeUTF8(utf8);
        } else if (length <= 255) {
            this.writeUTF8_Length8(utf8);
        } else if (length <= 65535) {
            this.writeUTF8_Length16LE(utf8);
        } else if (length <= 4294967295) {
            this.writeUTF8_Length32LE(utf8);
        } else if (length <= Number.MAX_SAFE_INTEGER) { // use correct uin64 restriction when we convert to bigint
            this.writeUTF8_Length64LE(utf8);
        } else {
            this.writeUTF8_NULL_terminated(utf8);
        }
    }

    private _writeUTF8(utf8: string) { // utility method
        const byteLength = Buffer.byteLength(utf8);
        this.ensureLength(byteLength);

        this.data.write(utf8, this.writerIndex, undefined, "utf8");
        this.writerIndex += byteLength;
    }

    private writeUTF8_Length8(utf8: string) {
        const length = Buffer.byteLength(utf8);
        this.ensureLength(2 + length);

        this.writeTag(DataFormatTags.UTF8_LENGTH8);
        this.writeLength8(length);
        this._writeUTF8(utf8);
    }

    private writeUTF8_Length16LE(utf8: string) {
        const length = Buffer.byteLength(utf8);
        this.ensureLength(3 + length);

        this.writeTag(DataFormatTags.UTF8_LENGTH16LE);
        this.writeLength16LE(length);
        this._writeUTF8(utf8);
    }

    private writeUTF8_Length32LE(utf8: string) {
        const length = Buffer.byteLength(utf8);
        this.ensureLength(5 + length);

        this.writeTag(DataFormatTags.UTF8_LENGTH32LE);
        this.writeLength32LE(length);
        this._writeUTF8(utf8);
    }

    private writeUTF8_Length64LE(utf8: string) {
        const length = Buffer.byteLength(utf8);
        this.ensureLength(9 + length);

        this.writeTag(DataFormatTags.UTF8_LENGTH64LE);
        this.writeLength64LE(length);
        this._writeUTF8(utf8);
    }

    private writeUTF8_NULL_terminated(utf8: string) {
        this.ensureLength(1 + Buffer.byteLength(utf8) + 1);

        this.writeTag(DataFormatTags.UTF8_NULL_TERMINATED);
        this._writeUTF8(utf8);
        this.data.writeUInt8(0, this.writerIndex++);
    }

    writeData(data: Buffer) {
        if (this.compressDataIfPossible(data)) {
            return;
        }

        if (data.length <= 32) {
            this.writeTag(DataFormatTags.DATA_LENGTH_START + data.length);
            this._writeData(data);
        } else if (data.length <= 255) {
            this.writeData_Length8(data);
        } else if (data.length <= 65535) {
            this.writeData_Length16LE(data);
        } else if (data.length <= 4294967295) {
            this.writeData_Length32LE(data);
        } else if (data.length <= Number.MAX_SAFE_INTEGER) {
            this.writeData_Length64LE(data);
        } else {
            this.writeData_terminated(data);
        }
    }

    private _writeData(data: Buffer) { // utility method
        this.ensureLength(data.length);
        for (let i = 0; i < data.length; i++) {
            this.data[this.writerIndex++] = data[i];
        }
    }

    private writeData_Length8(data: Buffer) {
        this.ensureLength(2 + data.length);

        this.writeTag(DataFormatTags.DATA_LENGTH8);
        this.writeLength8(data.length);
        this._writeData(data);
    }

    private writeData_Length16LE(data: Buffer) {
        this.ensureLength(3 + data.length);

        this.writeTag(DataFormatTags.DATA_LENGTH16LE);
        this.writeLength16LE(data.length);
        this._writeData(data);
    }

    private writeData_Length32LE(data: Buffer) {
        this.ensureLength(5 + data.length);

        this.writeTag(DataFormatTags.DATA_LENGTH32LE);
        this.writeLength32LE(data.length);
        this._writeData(data);
    }

    private writeData_Length64LE(data: Buffer) {
        this.ensureLength(9 + data.length);

        this.writeTag(DataFormatTags.DATA_LENGTH64LE);
        this.writeLength64LE(data.length);
        this._writeData(data);
    }

    private writeData_terminated(data: Buffer) {
        this.ensureLength(1 + data.length + 1);

        this.writeTag(DataFormatTags.DATA_TERMINATED);
        this._writeData(data);
        this.writeTag(DataFormatTags.TERMINATOR);
    }

    writeSecondsSince2001_01_01(seconds: SecondsSince2001) {
        if (this.compressDataIfPossible(seconds)) {
            return;
        }

        this.ensureLength(9);
        this.writeTag(DataFormatTags.DATE);
        this.data.writeDoubleLE(seconds.value, this.writerIndex);
        this.writerIndex += 8;
    }

    writeUUID(uuid_string: string) {
        assert(uuid.isValid(uuid_string), "supplied uuid is invalid");
        if (this.compressDataIfPossible(new UUID(uuid_string))) {
            return;
        }

        this.ensureLength(17);
        this.writeTag(DataFormatTags.UUID);
        uuid.write(uuid_string, this.data, this.writerIndex);
        this.writerIndex += 16;
    }

}
