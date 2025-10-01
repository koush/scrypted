import { Socket as DatagramSocket } from "dgram";
import { once } from "events";
import { Duplex } from "stream";
import { FFMPEG_FRAGMENTED_MP4_OUTPUT_ARGS, MP4Atom, parseFragmentedMP4 } from "./ffmpeg-mp4-parser-session";

export interface StreamParser {
    container: string;
    inputArguments?: string[];
    outputArguments: string[];
    tcpProtocol?: string;
    parse?: (duplex: Duplex, width: number, height: number) => AsyncGenerator<StreamChunk>;
    findSyncFrame(streamChunks: StreamChunk[]): StreamChunk[];
}

function findSyncFrame(streamChunks: StreamChunk[]): StreamChunk[] {
    return streamChunks;
}

export interface StreamParserOptions {
    acodec?: string[];
    vcodec?: string[];
}

export interface StreamChunk {
    startStream?: Buffer;
    chunks: Buffer[];
    type: string;
    width?: number;
    height?: number;
}

export function createDgramParser() {
    async function* parse(socket: DatagramSocket, width: number, height: number, type: string) {
        while (true) {
            const [buffer] = await once(socket, 'message');
            yield {
                chunks: [buffer],
                type,
            }
        }
    };
    return parse;
}

export async function* parseMp4StreamChunks(parser: AsyncGenerator<MP4Atom>) {
    let ftyp: MP4Atom;
    let moov: MP4Atom;
    let startStream: Buffer;
    for await (const atom of parser) {
        if (!ftyp) {
            ftyp = atom;
        }
        else if (!moov) {
            moov = atom;
        }

        yield {
            startStream,
            chunks: [atom.header, atom.data],
            type: atom.type,
        };

        if (ftyp && moov && !startStream) {
            startStream = Buffer.concat([ftyp.header, ftyp.data, moov.header, moov.data])
        }
    }
}

export function createFragmentedMp4Parser(options?: StreamParserOptions): StreamParser {
    return {
        container: 'mp4',
        outputArguments: [
            ...(options?.vcodec || []),
            ...(options?.acodec || []),
            ...FFMPEG_FRAGMENTED_MP4_OUTPUT_ARGS,
        ],
        async *parse(socket: Duplex): AsyncGenerator<StreamChunk> {
            const parser = parseFragmentedMP4(socket);
            yield* parseMp4StreamChunks(parser);
        },
        findSyncFrame,
    }
}

export interface RawVideoParserOptions {
    size: {
        width: number,
        height: number
    };
    everyNFrames?: number;
    pixelFormat?: RawVideoPixelFormat;
}

export interface RawVideoPixelFormat {
    name: string;
    computeLength: (width: number, height: number) => number;
}

export const PIXEL_FORMAT_YUV420P: RawVideoPixelFormat = {
    name: 'yuv420p',
    computeLength: (width, height) => width * height * 1.5,
}

export const PIXEL_FORMAT_RGB24: RawVideoPixelFormat = {
    name: 'rgb24',
    computeLength: (width, height) => width * height * 3,
}
