import { once } from "events";
import { Socket } from "net";
import { Readable } from "stream";
import { readLength } from "./read-length";

export interface StreamParser {
    container: string;
    outputArguments: string[];
    parse: (socket: Socket, width: number, height: number) => AsyncGenerator<StreamChunk>;
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

export function createMpegTsParser(options?: StreamParserOptions): StreamParser {
    return {
        container: 'mpegts',
        outputArguments: [
            '-f', 'mpegts',
            ...(options?.vcodec || []),
            ...(options?.acodec || []),
        ],
        async *parse(socket: Socket): AsyncGenerator<StreamChunk> {
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
                if (pendingSize < 188)
                    continue;

                const concat = Buffer.concat(pending);

                if (concat[0] != 0x47) {
                    throw new Error('Invalid sync byte in mpeg-ts packet. Terminating stream.')
                }

                const remaining = concat.length % 188;
                const left = concat.slice(0, concat.length - remaining);
                const right = concat.slice(concat.length - remaining);
                pending = [right];
                pendingSize = right.length;
                yield {
                    chunks: [left],
                };
            }
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
            '-f', 'mp4',
            ...(options?.vcodec || []),
            ...(options?.acodec || []),
            '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
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

                yield{
                    startStream,
                    chunks: [atom.header, atom.data],
                    type: atom.type,
                };

                if (ftyp && moov && !startStream) {
                    startStream = Buffer.concat([ftyp.header, ftyp.data, moov.header, moov.data])
                }
            }
        }
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
        }
    }
}