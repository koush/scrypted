import { Socket as DatagramSocket } from "dgram";
import { once } from "events";
import { Duplex } from "stream";
import { FFMPEG_FRAGMENTED_MP4_OUTPUT_ARGS, MP4Atom, parseFragmentedMP4 } from "./ffmpeg-mp4-parser-session";
import { readLength } from "./read-stream";

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
    type?: string;
    width?: number;
    height?: number;
}

// function checkTsPacket(pkt: Buffer) {
//     const pid = ((pkt[1] & 0x1F) << 8) | pkt[2];
//     if (pid == 256) {
//         // found video stream
//         if ((pkt[3] & 0x20) && (pkt[4] > 0)) {
//             // have AF
//             if (pkt[5] & 0x40) {
//                 // found keyframe
//                 console.log('keyframe');
//             }
//         }
//     }
// }

function createLengthParser(length: number, verify?: (concat: Buffer) => void) {
    async function* parse(socket: Duplex): AsyncGenerator<StreamChunk> {
        let pending: Buffer[] = [];
        let pendingSize = 0;
        while (true) {
            const data: Buffer = socket.read();
            if (!data) {
                await once(socket, 'readable');
                continue;
            }
            pending.push(data);
            pendingSize += data.length;
            if (pendingSize < length)
                continue;

            const concat = Buffer.concat(pending);

            verify?.(concat);

            const remaining = concat.length % length;
            const left = concat.slice(0, concat.length - remaining);
            const right = concat.slice(concat.length - remaining);
            pending = [right];
            pendingSize = right.length;

            yield {
                chunks: [left],
            };
        }
    }

    return parse;
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

export function createMpegTsParser(options?: StreamParserOptions): StreamParser {
    return {
        container: 'mpegts',
        outputArguments: [
            ...(options?.vcodec || []),
            ...(options?.acodec || []),
            '-f', 'mpegts',
        ],
        parse: createLengthParser(188, concat => {
            if (concat[0] != 0x47) {
                throw new Error('Invalid sync byte in mpeg-ts packet. Terminating stream.')
            }
        }),
        findSyncFrame(streamChunks): StreamChunk[] {
            for (let prebufferIndex = 0; prebufferIndex < streamChunks.length; prebufferIndex++) {
                const streamChunk = streamChunks[prebufferIndex];

                for (let chunkIndex = 0; chunkIndex < streamChunk.chunks.length; chunkIndex++) {
                    const chunk = streamChunk.chunks[chunkIndex];

                    let offset = 0;
                    while (offset + 188 < chunk.length) {
                        const pkt = chunk.subarray(offset, offset + 188);
                        const pid = ((pkt[1] & 0x1F) << 8) | pkt[2];
                        if (pid == 256) {
                            // found video stream
                            if ((pkt[3] & 0x20) && (pkt[4] > 0)) {
                                // have AF
                                if (pkt[5] & 0x40) {
                                    // we found the sync frame, but also need to send the pat and pmt
                                    // which might be at the start of this chunk before the keyframe.
                                    // yolo!
                                    return streamChunks.slice(prebufferIndex);
                                    // const chunks = streamChunk.chunks.slice(chunkIndex + 1);
                                    // const take = chunk.subarray(offset);
                                    // chunks.unshift(take);

                                    // const remainingChunks = streamChunks.slice(prebufferIndex + 1);
                                    // const ret = Object.assign({}, streamChunk);
                                    // ret.chunks = chunks;
                                    // return [
                                    //     ret,
                                    //     ...remainingChunks
                                    // ];
                                }
                            }
                        }

                        offset += 188;
                    }

                }
            }

            return findSyncFrame(streamChunks);
        }
    }
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

export function createRawVideoParser(options: RawVideoParserOptions): StreamParser {
    const pixelFormat = options?.pixelFormat || PIXEL_FORMAT_YUV420P;
    let filter: string;
    const { size, everyNFrames } = options;
    if (size) {
        filter = `scale=${size.width}:${size.height}`;
    }
    if (everyNFrames && everyNFrames > 1) {
        if (filter)
            filter += ',';
        else
            filter = '';
        filter = filter + `select=not(mod(n\\,${everyNFrames}))`
    }

    const inputArguments: string[] = [];
    if (options.size)
        inputArguments.push('-s', `${options.size.width}x${options.size.height}`);

    inputArguments.push('-pix_fmt', pixelFormat.name);
    return {
        inputArguments,
        container: 'rawvideo',
        outputArguments: [
            '-s', `${options.size.width}x${options.size.height}`,
            '-an',
            '-vcodec', 'rawvideo',
            '-pix_fmt', pixelFormat.name,
            '-f', 'rawvideo',
        ],
        async *parse(socket: Duplex, width: number, height: number): AsyncGenerator<StreamChunk> {
            width = size?.width || width;
            height = size?.height || height

            if (!width || !height)
                throw new Error("error parsing rawvideo, unknown width and height");

            const toRead = pixelFormat.computeLength(width, height);
            while (true) {
                const buffer = await readLength(socket, toRead);
                yield {
                    chunks: [buffer],
                    width,
                    height,
                }
            }
        },
        findSyncFrame,
    }
}