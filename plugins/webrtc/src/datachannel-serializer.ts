import { createRpcDuplexSerializer } from "@scrypted/server/src/rpc-serializer";

export function createDataChannelSerializer(dc: { send: (data: Buffer) => void }) {
    // Chunking and debouncing state
    let pending: Buffer[];
    
    // Max packet size for data channels is 16KB
    const MAX_PACKET_SIZE = 16384;

    // Flush pending chunks with proper chunking
    function flushPending() {
        if (!pending || pending.length === 0)
            return;
            
        const chunks = pending;
        pending = undefined;
        
        // Process all pending chunks
        for (const data of chunks) {
            let offset = 0;
            
            // Split data into chunks that fit within MAX_PACKET_SIZE
            while (offset < data.length) {
                const remaining = data.length - offset;
                const chunkSize = Math.min(remaining, MAX_PACKET_SIZE);
                const chunkData = data.subarray(offset, offset + chunkSize);
                
                dc.send(chunkData);
                offset += chunkSize;
            }
        }
    }

    // Queue data for sending with next-tick debouncing
    function queuePending(data: Buffer) {
        const hadPending = !!pending;
        if (!pending)
            pending = [];
        pending.push(data);
        
        // Schedule flush for next tick if not already scheduled
        if (!hadPending) {
            setTimeout(() => flushPending(), 0);
        }
    }

    // Create a wrapper around the data channel send method for chunking
    const chunkingDataChannel = {
        write: (data: Buffer) => {
            queuePending(data);
        }
    };

    // Create the duplex serializer which handles all RPC serialization
    const duplexSerializer = createRpcDuplexSerializer(chunkingDataChannel);

    return duplexSerializer;
}
