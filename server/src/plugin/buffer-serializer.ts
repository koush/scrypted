import { RpcSerializer } from "@scrypted/rpc";

export class BufferSerializer implements RpcSerializer {
    serialize(value: Buffer) {
        return value.toString('base64');
    }
    deserialize(serialized: any) {
        return Buffer.from(serialized, 'base64');
    }
}
