import sdk, { FFmpegInput, RequestMediaStreamOptions, ResponseMediaStreamOptions } from "@scrypted/sdk";
import child_process, { ChildProcess, StdioOptions } from 'child_process';
import { EventEmitter } from 'events';
import { Server } from 'net';
import { Duplex } from 'stream';
import { cloneDeep } from './clone-deep';
import { Deferred } from "./deferred";
import { listenZeroSingleClient } from './listen-cluster';
import { ffmpegLogInitialOutput, safeKillFFmpeg, safePrintFFmpegArguments } from './media-helpers';
import { createRtspParser } from "./rtsp-server";
import { parseSdp } from "./sdp-utils";
import { StreamChunk, StreamParser } from './stream-parser';

const { mediaManager } = sdk;

export interface ParserSession<T extends string> {
    parserSpecific?: any;
    sdp: Promise<Buffer[]>;
    resetActivityTimer?: () => void,
    negotiateMediaStream(requestMediaStream: RequestMediaStreamOptions): ResponseMediaStreamOptions;
    inputAudioCodec?: string;
    inputVideoCodec?: string;
    inputVideoResolution?: {
        width: number,
        height: number,
    },
    start(): void;
    kill(error?: Error): void;
    killed: Promise<void>;
    isActive: boolean;

    emit(container: T, chunk: StreamChunk): this;
    on(container: T, callback: (chunk: StreamChunk) => void): this;
    removeListener(event: T | 'killed', callback: any): this;
    once(event: T | 'killed', listener: (...args: any[]) => void): this;
}

export interface ParserOptions<T extends string> {
    parsers: { [container in T]?: StreamParser };
    timeout?: number;
    console: Console;
    storage?: Storage;
}

export async function parseResolution(cp: ChildProcess) {
    return new Promise<string[]>((resolve, reject) => {
        cp.on('exit', () => reject(new Error('ffmpeg exited while waiting to parse stream resolution')));
        const parser = (data: Buffer) => {
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

async function parseInputToken(cp: ChildProcess, token: string) {
    let processed = 0;
    return new Promise<string>((resolve, reject) => {
        cp.on('exit', () => reject(new Error('ffmpeg exited while waiting to parse stream information: ' + token)));
        const parser = (data: Buffer) => {
            processed += data.length;
            if (processed > 10000)
                return resolve(undefined);
            const stdout: string = data.toString().split('Output ')[0];
            const idx = stdout.lastIndexOf(`${token}: `);
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
    })
        .finally(() => {
            cp.stdout.removeAllListeners('data');
            cp.stderr.removeAllListeners('data');
        });
}

export async function parseVideoCodec(cp: ChildProcess) {
    return parseInputToken(cp, 'Video');
}

export async function parseAudioCodec(cp: ChildProcess) {
    return parseInputToken(cp, 'Audio');
}

export function setupActivityTimer(container: string, kill: (error?: Error) => void, events: {
    once(event: 'killed', callback: () => void): void,
}, timeout: number) {
    let dataTimeout: NodeJS.Timeout;

    function dataKill() {
        const str = 'timeout waiting for data, killing parser session';
        console.error(str, container);
        kill(new Error(str));
    }

    let lastTime = Date.now();
    function resetActivityTimer() {
        lastTime = Date.now();
    }

    function clearActivityTimer() {
        clearInterval(dataTimeout);
    }

    if (timeout) {
        dataTimeout = setInterval(() => {
            if (Date.now() > lastTime + timeout) {
                clearInterval(dataTimeout);
                dataTimeout = undefined;
                dataKill();
            }
        }, timeout);
    }

    events.once('killed', () => clearInterval(dataTimeout));

    resetActivityTimer();
    return {
        resetActivityTimer,
        clearActivityTimer,
    }
}


export async function startParserSession<T extends string>(ffmpegInput: FFmpegInput, options: ParserOptions<T>): Promise<ParserSession<T>> {
    const { console } = options;

    let isActive = true;
    const events = new EventEmitter();
    // need this to prevent kill from throwing due to uncaught Error during cleanup
    events.on('error', e => console.error('rebroadcast error', e));

    let inputAudioCodec: string;
    let inputVideoCodec: string;
    let inputVideoResolution: string[];

    let sessionKilled: any;
    const killed = new Promise<void>(resolve => {
        sessionKilled = resolve;
    });

    function kill(error?: Error) {
        if (isActive) {
            events.emit('killed');
            events.emit('error', error || new Error('killed'));
        }
        isActive = false;
        sessionKilled();
        safeKillFFmpeg(cp);
    }


    const args = ffmpegInput.inputArguments.slice();

    const ensureActive = (killed: () => void) => {
        if (!isActive) {
            killed();
            throw new Error('parser session was killed killed before ffmpeg connected');
        }
        events.on('killed', killed);
    }

    // first see how many pipes are needed, and prep them for the child process
    const stdio: StdioOptions = ['pipe', 'pipe', 'pipe']
    let pipeCount = 3;
    const startParsers: (() => void)[] = [];
    for (const container of Object.keys(options.parsers)) {
        const parser: StreamParser = options.parsers[container as T];

        if (parser.tcpProtocol) {
            const tcp = await listenZeroSingleClient();
            const url = new URL(parser.tcpProtocol);
            url.port = tcp.port.toString();
            args.push(
                ...parser.outputArguments,
                url.toString(),
            );

            const { resetActivityTimer } = setupActivityTimer(container, kill, events, options?.timeout);

            startParsers.push(async () => {
                const socket = await tcp.clientPromise;
                try {
                    ensureActive(() => socket.destroy());

                    for await (const chunk of parser.parse(socket, parseInt(inputVideoResolution?.[2]), parseInt(inputVideoResolution?.[3]))) {
                        events.emit(container, chunk);
                        resetActivityTimer();
                    }
                }
                catch (e) {
                    console.error('rebroadcast parse error', e);
                    kill(e);
                }
            });
        }
        else {
            args.push(
                ...parser.outputArguments,
                `pipe:${pipeCount++}`,
            );
            stdio.push('pipe');
        }
    }

    // start ffmpeg process with child process pipes
    args.unshift('-hide_banner');
    safePrintFFmpegArguments(console, args);
    const cp = child_process.spawn(await mediaManager.getFFmpegPath(), args, {
        stdio,
    });
    ffmpegLogInitialOutput(console, cp, undefined, options?.storage);
    cp.on('exit', () => kill(new Error('ffmpeg exited')));

    const deferredStart = new Deferred<void>();
    // now parse the created pipes
    const start = () => {
        for (const p of startParsers) {
            p();
        }

        let pipeIndex = 0;
        Object.keys(options.parsers).forEach(async (container) => {
            const parser: StreamParser = options.parsers[container as T];
            if (!parser.parse || parser.tcpProtocol)
                return;
            const pipe = cp.stdio[3 + pipeIndex];
            pipeIndex++;

            try {
                const { resetActivityTimer } = setupActivityTimer(container, kill, events, options?.timeout);

                for await (const chunk of parser.parse(pipe as any, parseInt(inputVideoResolution?.[2]), parseInt(inputVideoResolution?.[3]))) {
                    await deferredStart.promise;
                    events.emit(container, chunk);
                    resetActivityTimer();
                }
            }
            catch (e) {
                console.error('rebroadcast parse error', e);
                kill(e);
            }
        });
    };

    const rtsp = (options.parsers as any).rtsp as ReturnType<typeof createRtspParser>;
    rtsp.sdp.then(sdp => {
        const parsed = parseSdp(sdp);
        const audio = parsed.msections.find(msection => msection.type === 'audio');
        const video = parsed.msections.find(msection => msection.type === 'video');
        inputVideoCodec = video?.codec;
        inputAudioCodec = audio?.codec;
    });

    const sdp = new Deferred<Buffer[]>();
    rtsp.sdp.then(r => sdp.resolve([Buffer.from(r)]));
    killed.then(() => sdp.reject(new Error("ffmpeg killed before sdp could be parsed")));

    start();

    return {
        start() {
            deferredStart.resolve();
        },
        sdp: sdp.promise,
        get inputAudioCodec() {
            return inputAudioCodec;
        },
        get inputVideoCodec() {
            return inputVideoCodec;
        },
        get inputVideoResolution() {
            return {
                width: parseInt(inputVideoResolution?.[2]),
                height: parseInt(inputVideoResolution?.[3]),
            }
        },
        get isActive() { return isActive },
        kill(error?: Error) {
            kill(error);
        },
        killed,
        negotiateMediaStream: () => {
            const ret: ResponseMediaStreamOptions = cloneDeep(ffmpegInput.mediaStreamOptions) || {
                id: undefined,
                name: undefined,
            };

            if (!ret.video)
                ret.video = {};

            ret.video.codec = inputVideoCodec;

            // reported codecs may be wrong/cached/etc, so before blindly copying the audio codec info,
            // verify what was found.
            if (ret?.audio?.codec === inputAudioCodec) {
                ret.audio = ffmpegInput?.mediaStreamOptions?.audio;
            }
            else {
                ret.audio = {
                    codec: inputAudioCodec,
                }
            }

            return ret;
        },
        emit(container: T, chunk: StreamChunk) {
            events.emit(container, chunk);
            return this;
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
    url: string;
    clients: number;
}

export interface RebroadcastSessionCleanup {
    (): void;
}

export interface RebroadcasterConnection {
    writeData: (data: StreamChunk) => number;
    destroy: () => void;
}

export interface RebroadcasterOptions {
    connect?: (connection: RebroadcasterConnection) => RebroadcastSessionCleanup | undefined;
    console?: Console;
    idle?: {
        timeout: number,
        callback: () => void,
    },
}

export function handleRebroadcasterClient(socket: Duplex, options?: RebroadcasterOptions) {
    const firstWriteData = (data: StreamChunk) => {
        if (data.startStream) {
            socket.write(data.startStream)
        }
        connection.writeData = writeData;
        return writeData(data);
    }
    const writeData = (data: StreamChunk) => {
        for (const chunk of data.chunks) {
            socket.write(chunk);
        }

        return socket.writableLength;
    };

    const destroy = () => {
        const cb = cleanupCallback;
        cleanupCallback = undefined;
        socket.destroy();
        cb?.();
    }

    const connection: RebroadcasterConnection = {
        writeData: firstWriteData,
        destroy,
    };

    let cleanupCallback = options?.connect(connection);

    socket.once('close', () => {
        destroy();
    });
    socket.on('error', e => options?.console?.log('client stream ended'));
}
