import { RpcSerializer } from "../rpc";

export class SidebandSocketSerializer implements RpcSerializer {
    serialize(value: any, serializationContext?: any) {
        if (!serializationContext)
            throw new Error('socket serialization context unavailable');
        serializationContext.sendHandle = value;
    }

    deserialize(serialized: any, serializationContext?: any) {
        if (!serializationContext)
            throw new Error('socket deserialization context unavailable');
        return serializationContext.sendHandle;
    }
}
