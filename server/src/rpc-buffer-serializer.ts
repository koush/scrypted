import { RpcSerializer } from "./rpc";

export class BufferSerializer implements RpcSerializer {
    serialize(value: Buffer) {
        console.warn('Using slow buffer serialization. Ensure the peer supports SidebandBufferSerializer.');
        return value.toString('base64');
    }
    deserialize(serialized: any) {
        console.warn('Using slow buffer deserialization. Ensure the peer supports SidebandBufferSerializer.');
        return Buffer.from(serialized, 'base64');
    }
}

export class SidebandBufferSerializer implements RpcSerializer {
    bufferSerializer = new BufferSerializer();

    serialize(value: any, serializationContext?: any) {
        if (!serializationContext)
            return this.bufferSerializer.serialize(value);
        const buffers: Buffer[] = serializationContext.buffers = serializationContext.buffers || [];
        buffers.push(value);
        return buffers.length - 1;
    }

    deserialize(serialized: any, serializationContext?: any) {
        if (!serializationContext?.buffers)
            return this.bufferSerializer.deserialize(serialized);
        const buffers: Buffer[] = serializationContext.buffers;
        return buffers[serialized];
    }
}
