import { createServer, Server } from 'net';
import child_process, { StdioOptions } from 'child_process';
import { ChildProcess } from 'child_process';
import { FFMpegInput, MediaStreamOptions } from '@scrypted/sdk/types';
import { bind, bindZero, listenZero } from './listen-cluster';
import { EventEmitter } from 'events';
import sdk from "@scrypted/sdk";
import { ffmpegLogInitialOutput, safePrintFFmpegArguments } from './media-helpers';
import { StreamChunk, StreamParser } from './stream-parser';
import dgram from 'dgram';

const { mediaManager } = sdk;

export interface MP4Atom {
    header: Buffer;
    length: number;
    type: string;
    data: Buffer;
}

export interface ParserSession<T extends string> {
    sdp: Promise<Buffer[]>;
    mediaStreamOptions: MediaStreamOptions;
    inputAudioCodec?: string;
    inputVideoCodec?: string;
    inputVideoResolution?: string[];
    kill(): void;
    isActive(): boolean;
    resetActivityTimer(): void;

    on(container: T, callback: (chunk: StreamChunk) => void): this;
    on(event: 'killed', callback: () => void): this;
    once(event: 'killed', callback: () => void): this;
    removeListener(event: T | 'killed', callback: any): this;
    once(event: string | symbol, listener: (...args: any[]) => void): this;
}

export interface ParserOptions<T extends string> {
    parsers: { [container in T]?: StreamParser };
    timeout?: number;
    console: Console;
}

export async function parseResolution(cp: ChildProcess) {
    return new Promise<string[]>(resolve => {
        const parser = data => {
            const stdout = data.toString();
            const res = /(([0-9]{2,5})x([0-9]{2,5}))/.exec(stdout);
            if (res) {
                cp.stdout.removeListener('data', parser);
                cp.stderr.removeListener('data', parser);
                resolve(res);
            }
        };
        cp.stdout.on('data', parser);
        cp.stderr.on('data', parser);
    });
}

async function parseToken(cp: ChildProcess, token: string) {
    return new Promise<string>(resolve => {
        const parser = data => {
            const stdout: string = data.toString();
            const idx = stdout.indexOf(`${token}: `);
            if (idx !== -1) {
                const check = stdout.substring(idx + token.length + 1).trim();
                let next = check.indexOf(' ');
                const next2 = check.indexOf(',');
                if (next !== -1 && next2 < next)
                    next = next2;
                if (next !== -1) {
                    cp.stdout.removeListener('data', parser);
                    cp.stderr.removeListener('data', parser);
                    resolve(check.substring(0, next));
                }
            }
        };
        cp.stdout.on('data', parser);
        cp.stderr.on('data', parser);
    });
}

export async function parseVideoCodec(cp: ChildProcess) {
    return parseToken(cp, 'Video');
}

export async function parseAudioCodec(cp: ChildProcess) {
    return parseToken(cp, 'Audio');
}

export async function startParserSession<T extends string>(ffmpegInput: FFMpegInput, options: ParserOptions<T>): Promise<ParserSession<T>> {
    const { console } = options;

    let dataTimeout: NodeJS.Timeout;
    let ffmpegIncomingConnectionTimeout: NodeJS.Timeout;
    let isActive = true;
    const events = new EventEmitter();
    events.on('error', e => console.error('rebroadcast error', e));

    let inputAudioCodec: string;
    let inputVideoCodec: string;
    let inputVideoResolution: string[];

    let ffmpegStartedResolve: any;
    let ffmpegStartedReject: any;
    const connectPromise = new Promise((r, rj) => {
        ffmpegStartedResolve = r;
        ffmpegStartedReject = rj;
    });

    function kill() {
        if (isActive) {
            events.emit('killed');
            events.emit('error', new Error('killed'));
        }
        isActive = false;
        cp?.kill();
        // might need this too?
        cp?.kill('SIGKILL');
        ffmpegStartedReject?.(new Error('ffmpeg was killed before connecting to the rebroadcast session'));
        clearTimeout(dataTimeout);
        clearTimeout(ffmpegIncomingConnectionTimeout);
    }

    function dataKill() {
        console.error('timeout waiting for data, killing parser session');
        kill();
    }

    function resetActivityTimer() {
        if (!options.timeout)
            return;
        clearTimeout(dataTimeout);
        dataTimeout = setTimeout(dataKill, options.timeout);
    }

    resetActivityTimer();

    const args = ffmpegInput.inputArguments.slice();

    ffmpegIncomingConnectionTimeout = setTimeout(kill, 30000);

    // first see how many pipes are needed, and prep them for the child process
    const stdio: StdioOptions = ['pipe', 'pipe', 'pipe']
    let pipeCount = 3;
    for (const container of Object.keys(options.parsers)) {
        const parser: StreamParser = options.parsers[container];
        if (parser.parseDatagram) {
            const socket = dgram.createSocket('udp4')
            // todo: fix these leaking sockets
            const udp = await bindZero(socket);
            const rtcp = dgram.createSocket('udp4');
            await bind(rtcp, udp.port + 1);
            args.push(
                ...parser.outputArguments,
                udp.url.replace('udp://', 'rtp://'),
            );

            (async () => {
                for await (const chunk of parser.parseDatagram(socket, parseInt(inputVideoResolution?.[2]), parseInt(inputVideoResolution?.[3]))) {
                    ffmpegStartedResolve?.(undefined);
                    events.emit(container, chunk);
                    resetActivityTimer();
                }
            })();

            (async () => {
                for await (const chunk of parser.parseDatagram(rtcp, parseInt(inputVideoResolution?.[2]), parseInt(inputVideoResolution?.[3]), 'rtcp')) {
                    ffmpegStartedResolve?.(undefined);
                    events.emit(container, chunk);
                    resetActivityTimer();
                }
            })();
        }
        else {
            args.push(
                ...parser.outputArguments,
                `pipe:${pipeCount++}`,
            );
            stdio.push('pipe');
        }
    }

    args.push('-sdp_file', `pipe:${pipeCount++}`);
    stdio.push('pipe');

    // start ffmpeg process with child process pipes
    args.unshift('-hide_banner');
    safePrintFFmpegArguments(console, args);
    const cp = child_process.spawn(await mediaManager.getFFmpegPath(), args, {
        stdio,
    });
    ffmpegLogInitialOutput(console, cp);
    cp.on('exit', kill);

    const sdp  = new Promise<Buffer[]>(resolve => {
        const ret = [];
        cp.stdio[pipeCount - 1].on('data', buffer => {
            ret.push(buffer);
            resolve(ret);
        });
    })

    // now parse the created pipes
    let pipeIndex = 0;
    Object.keys(options.parsers).forEach(async (container) => {
        const parser: StreamParser = options.parsers[container];
        if (!parser.parse)
            return;
        const pipe = cp.stdio[3 + pipeIndex];
        pipeIndex++;

        try {
            for await (const chunk of parser.parse(pipe as any, parseInt(inputVideoResolution?.[2]), parseInt(inputVideoResolution?.[3]))) {
                ffmpegStartedResolve?.(undefined);
                events.emit(container, chunk);
                resetActivityTimer();
            }
        }
        catch (e) {
            console.error('rebroadcast parse error', e);
            kill();
        }
    });

    // tbh parsing stdout is super sketchy way of doing this.
    parseAudioCodec(cp).then(result => inputAudioCodec = result);
    parseVideoCodec(cp).then(result => inputVideoCodec = result);
    parseResolution(cp).then(result => inputVideoResolution = result);

    await connectPromise;
    ffmpegStartedResolve = undefined;
    ffmpegStartedReject = undefined;
    clearTimeout(ffmpegIncomingConnectionTimeout);

    return {
        sdp,
        inputAudioCodec,
        inputVideoCodec,
        inputVideoResolution,
        resetActivityTimer,
        isActive() { return isActive },
        kill,
        mediaStreamOptions: ffmpegInput.mediaStreamOptions || {
            id: undefined,
            name: undefined,
        },
        on(event: string, cb: any) {
            events.on(event, cb);
            return this;
        },
        once(event: any, cb: any) {
            events.once(event, cb);
            return this;
        },
        removeListener(event, cb) {
            events.removeListener(event, cb);
            return this;
        }
    };
}

export interface Rebroadcaster {
    server: Server;
    port: number;
    clients: number;
}

export interface RebroadcastSessionCleanup {
    (): void;
}

export interface RebroadcasterOptions {
    connect?: (writeData: (data: StreamChunk) => number, cleanup: () => void) => RebroadcastSessionCleanup | undefined;
    console?: Console;
}

export async function createRebroadcaster(options?: RebroadcasterOptions): Promise<Rebroadcaster> {
    let clientCount = 0;
    const server = createServer(socket => {
        let first = true;
        const writeData = (data: StreamChunk) => {
            if (first) {
                first = false;
                if (data.startStream) {
                    socket.write(data.startStream)
                }
            }
            for (const chunk of data.chunks) {
                socket.write(chunk);
            }

            return socket.writableLength;
        };

        const cleanup = () => {
            socket.removeAllListeners();
            socket.destroy();
            const cb = cleanupCallback;
            cleanupCallback = undefined;
            cb?.();
        }
        let cleanupCallback = options?.connect(writeData, cleanup);

        socket.once('close', () => {
            clientCount--;
            cleanup();
        });
        socket.on('error', e => options?.console?.log('client stream ended'));

        clientCount++;
    });
    const port = await listenZero(server);
    return {
        server,
        port,
        get clients() {
            return clientCount;
        }
    }
}