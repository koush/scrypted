import { createServer, Server } from 'net';
import child_process, { StdioOptions } from 'child_process';
import { ChildProcess } from 'child_process';
import { FFMpegInput } from '@scrypted/sdk/types';
import { bind, bindZero, listenZero, listenZeroSingleClient } from './listen-cluster';
import { EventEmitter } from 'events';
import sdk, { ResponseMediaStreamOptions } from "@scrypted/sdk";
import { ffmpegLogInitialOutput, safeKillFFmpeg, safePrintFFmpegArguments } from './media-helpers';
import { StreamChunk, StreamParser } from './stream-parser';
import dgram from 'dgram';
import { Duplex } from 'stream';

const { mediaManager } = sdk;

export interface ParserSession<T extends string> {
    sdp: Promise<Buffer[]>;
    mediaStreamOptions: ResponseMediaStreamOptions;
    inputAudioCodec?: string;
    inputVideoCodec?: string;
    inputVideoResolution?: string[];
    kill(): void;
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
    return new Promise<string[]>(resolve => {
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

async function parseToken(cp: ChildProcess, token: string) {
    return new Promise<string>(resolve => {
        const parser = (data: Buffer) => {
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

export function setupActivityTimer(container: string, kill: () => void, events: {
    once(event: 'killed', callback: () => void): void,
}, timeout: number) {
    let dataTimeout: NodeJS.Timeout;

    function dataKill() {
        console.error('timeout waiting for data, killing parser session', container);
        kill();
    }

    function resetActivityTimer() {
        if (!timeout)
            return;
        clearTimeout(dataTimeout);
        dataTimeout = setTimeout(dataKill, timeout);
    }

    events.once('killed', () => clearTimeout(dataTimeout));

    resetActivityTimer();
    return {
        resetActivityTimer,
    }
}


export async function startParserSession<T extends string>(ffmpegInput: FFMpegInput, options: ParserOptions<T>): Promise<ParserSession<T>> {
    const { console } = options;

    let ffmpegIncomingConnectionTimeout: NodeJS.Timeout;
    let isActive = true;
    const events = new EventEmitter();
    // need this to prevent kill from throwing due to uncaught Error during cleanup
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
    let sessionKilled: any;
    const killed = new Promise<void>(resolve => {
        sessionKilled = resolve;
    });

    function kill() {
        if (isActive) {
            events.emit('killed');
            events.emit('error', new Error('killed'));
        }
        isActive = false;
        clearTimeout(ffmpegIncomingConnectionTimeout);
        sessionKilled();
        ffmpegStartedReject?.(new Error('ffmpeg was killed before connecting to the rebroadcast session'));
        safeKillFFmpeg(cp);
    }


    const args = ffmpegInput.inputArguments.slice();

    ffmpegIncomingConnectionTimeout = setTimeout(kill, 30000);

    let needSdp = false;

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
    for (const container of Object.keys(options.parsers)) {
        const parser: StreamParser = options.parsers[container as T];

        if (parser.parseDatagram) {
            needSdp = true;
            const socket = dgram.createSocket('udp4');
            const udp = await bindZero(socket);
            const rtcp = dgram.createSocket('udp4');
            await bind(rtcp, udp.port + 1);
            ensureActive(() => {
                socket.close();
                rtcp.close();
            });
            args.push(
                ...parser.outputArguments,
                // using rtp instead of udp gives us the rtcp messages too.
                udp.url.replace('udp://', 'rtp://'),
            );

            const { resetActivityTimer } = setupActivityTimer(container, kill, events, options?.timeout);

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
        else if (parser.tcpProtocol) {
            const tcp = await listenZeroSingleClient();
            const url = new URL(parser.tcpProtocol);
            url.port = tcp.port.toString();
            args.push(
                ...parser.outputArguments,
                url.toString(),
            );

            const { resetActivityTimer } = setupActivityTimer(container, kill, events, options?.timeout);

            (async () => {
                const socket = await tcp.clientPromise;
                try {
                    ensureActive(() => socket.destroy());

                    for await (const chunk of parser.parse(socket, parseInt(inputVideoResolution?.[2]), parseInt(inputVideoResolution?.[3]))) {
                        ffmpegStartedResolve?.(undefined);
                        events.emit(container, chunk);
                        resetActivityTimer();
                    }
                }
                catch (e) {
                    console.error('rebroadcast parse error', e);
                    kill();
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

    if (needSdp) {
        args.push('-sdp_file', `pipe:${pipeCount++}`);
        stdio.push('pipe');
    }

    // start ffmpeg process with child process pipes
    args.unshift('-hide_banner');
    safePrintFFmpegArguments(console, args);
    const cp = child_process.spawn(await mediaManager.getFFmpegPath(), args, {
        stdio,
    });
    ffmpegLogInitialOutput(console, cp, undefined, options?.storage);
    cp.on('exit', kill);

    let sdp: Promise<Buffer[]>;
    if (needSdp) {
        sdp = new Promise<Buffer[]>(resolve => {
            const ret: Buffer[] = [];
            cp.stdio[pipeCount - 1].on('data', buffer => {
                ret.push(buffer);
                resolve(ret);
            });
        })
    }
    else {
        sdp = Promise.resolve([]);
    }

    // now parse the created pipes
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
        get isActive() { return isActive },
        kill,
        killed,
        mediaStreamOptions: ffmpegInput.mediaStreamOptions || {
            id: undefined,
            name: undefined,
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

export interface RebroadcasterOptions {
    connect?: (writeData: (data: StreamChunk) => number, destroy: () => void) => RebroadcastSessionCleanup | undefined;
    console?: Console;
    idle?: {
        timeout: number,
        callback: () => void,
    },
}

export async function createRebroadcaster(options?: RebroadcasterOptions): Promise<Rebroadcaster> {
    let clientCount = 0;
    let timeout: NodeJS.Timeout;
    const resetTimeout = () => {
        if (!options?.idle)
            return;

        clearTimeout(timeout);
        timeout = setTimeout(() => {
            if (clientCount === 0) {
                options.idle.callback();
                return;
            }
            resetTimeout();
        }, options.idle.timeout);
    }
    resetTimeout();

    const server = createServer(socket => {
        handleRebroadcasterClient(socket, options);
        socket.once('close', () => {
            resetTimeout();
            clientCount--;
        });
        resetTimeout();
        clientCount++;
    });
    const port = await listenZero(server);
    return {
        server,
        port,
        url: `tcp://127.0.0.1:${port}`,
        get clients() {
            return clientCount;
        }
    }
}

export async function createParserRebroadcaster<T extends string>(parserSession: ParserSession<T>, container: T, options?: RebroadcasterOptions) {
    const ret = await createRebroadcaster(Object.assign({}, options, {
        connect: (writeData, destroy) => {
            parserSession.on(container, writeData);
            return () => {
                destroy();
            }
        }
    } as RebroadcasterOptions));

    return ret;
}

export async function handleRebroadcasterClient(duplex: Promise<Duplex> | Duplex, options?: RebroadcasterOptions) {
    const socket = await duplex;
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

    const destroy = () => {
        socket.removeAllListeners();
        socket.destroy();
        const cb = cleanupCallback;
        cleanupCallback = undefined;
        cb?.();
    }
    let cleanupCallback = options?.connect(writeData, destroy);

    socket.once('close', () => {
        destroy();
    });
    socket.on('error', e => options?.console?.log('client stream ended'));
}
