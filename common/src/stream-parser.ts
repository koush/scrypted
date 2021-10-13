import { once } from "events";
import { Socket } from "net";
import { Readable } from "stream";
import { readLength } from "./read-length";

export interface StreamParser {
    container: string;
    outputArguments: string[];
    parse: (socket: Socket, width: number, height: number) => AsyncGenerator<StreamChunk>;
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
    async function* parse(socket: Socket): AsyncGenerator<StreamChunk> {
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

// -ac num channels? cameras are always mono?
export function createPCMParser(): StreamParser {
    return {
        container: 's16le',
        outputArguments: [
            '-vn',
            '-acodec', 'pcm_s16le',
            '-f', 's16le',
        ],
        parse: createLengthParser(512),
        findSyncFrame,
    }
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
                                    return streamChunks.slice(prebufferIndex);
                                    // const chunks = streamChunk.chunks.slice(chunkIndex + 1);
                                    // const take = chunk.subarray(offset);
                                    // chunks.unshift(take);

                                    // const remainingChunks = findSyncFrame(streamChunks.slice(prebufferIndex + 1));
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
export interface MP4Atom {
    header: Buffer;
    length: number;
    type: string;
    data: Buffer;
}

export async function* parseFragmentedMP4(readable: Readable): AsyncGenerator<MP4Atom> {
    while (true) {
        const header = await readLength(readable, 8);
        const length = header.readInt32BE(0) - 8;
        const type = header.slice(4).toString();
        const data = await readLength(readable, length);

        yield {
            header,
            length,
            type,
            data,
        };
    }
}

export function createFragmentedMp4Parser(options?: StreamParserOptions): StreamParser {
    return {
        container: 'mp4',
        outputArguments: [
            ...(options?.vcodec || []),
            ...(options?.acodec || []),
            '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
            '-f', 'mp4',
        ],
        async *parse(socket: Socket): AsyncGenerator<StreamChunk> {
            const parser = parseFragmentedMP4(socket);
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
        },
        findSyncFrame,
    }
}

export interface RawVideoParserOptions {
    size?: {
        width: number,
        height: number
    };
    everyNFrames?: number;
}

export function createRawVideoParser(options?: RawVideoParserOptions): StreamParser {
    let filter: string;
    options = options || {};
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

    return {
        container: 'rawvideo',
        outputArguments: [
            ...(filter ? ['-vf', filter] : []),
            '-an',
            '-vcodec', 'rawvideo',
            '-pix_fmt', 'yuv420p',
            '-f', 'rawvideo',
        ],
        async *parse(socket: Socket, width: number, height: number): AsyncGenerator<StreamChunk> {
            if (!width || !height)
                throw new Error("error parsing rawvideo, unknown width and height");

            width = size?.width || width;
            height = size?.height || height
            const toRead = width * height * 1.5;
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