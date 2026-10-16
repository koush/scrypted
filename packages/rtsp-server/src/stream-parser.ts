import { Duplex } from "stream";

export interface StreamParser {
    container: string;
    inputArguments?: string[];
    outputArguments: string[];
    tcpProtocol?: string;
    parse?: (duplex: Duplex, width: number, height: number) => AsyncGenerator<StreamChunk>;
    findSyncFrame(streamChunks: StreamChunk[]): StreamChunk[];
}

export interface StreamChunk {
    startStream?: Buffer;
    chunks: Buffer[];
    type: string;
    width?: number;
    height?: number;
}