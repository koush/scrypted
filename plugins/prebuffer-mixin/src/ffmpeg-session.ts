import { createActivityTimeout } from '@scrypted/common/src/activity-timeout';
import { cloneDeep } from '@scrypted/common/src/clone-deep';
import { Deferred } from "@scrypted/common/src/deferred";
import { listenZeroSingleClient } from '@scrypted/common/src/listen-cluster';
import { ffmpegLogInitialOutput, safeKillFFmpeg, safePrintFFmpegArguments } from '@scrypted/common/src/media-helpers';
import { createRtspParser } from "@scrypted/common/src/rtsp-server";
import { StreamChunk, StreamParser } from '@scrypted/common/src/stream-parser';
import sdk, { FFmpegInput, RequestMediaStreamOptions, ResponseMediaStreamOptions } from "@scrypted/sdk";
import child_process, { ChildProcess, StdioOptions } from 'child_process';
import { EventEmitter } from 'events';

const { mediaManager } = sdk;

export interface ParserSession<T extends string> {
    parserSpecific?: any;
    sdp: Promise<string>;
    resetActivityTimer?: () => void,
    negotiateMediaStream(requestMediaStream: RequestMediaStreamOptions, inputVideoCodec: string, inputAudioCodec: string): ResponseMediaStreamOptions;
    start(): void;
    kill(error?: Error): void;
    killed: Promise<void>;
    isActive: boolean;

    emit(container: T, chunk: StreamChunk): this;
    on(container: T, callback: (chunk: StreamChunk) => void): this;
    on(error: 'error', callback: (e: Error) => void): this;
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
    const ret = createActivityTimeout(timeout, () => {
        const str = 'timeout waiting for data, killing parser session';
        console.error(str, container);
        kill(new Error(str));
    });
    events.once('killed', () => ret.clearActivityTimer());
    return ret;
}

export async function startParserSession<T extends string>(ffmpegInput: FFmpegInput, options: ParserOptions<T>): Promise<ParserSession<T>> {
    const { console } = options;

    let isActive = true;
    const events = new EventEmitter();
    // need this to prevent kill from throwing due to uncaught Error during cleanup
    events.on('error', () => {});

    let sessionKilled: any;
    const killed = new Promise<void>(resolve => {
        sessionKilled = resolve;
    });

    const sdpDeferred = new Deferred<string>();
    function kill(error?: Error) {
        error ||= new Error('killed');
        if (isActive) {
            events.emit('killed');
            events.emit('error', error);
        }
        if (!sdpDeferred.finished)
            sdpDeferred.reject(error);
        isActive = false;
        sessionKilled();
        safeKillFFmpeg(cp);
    }


    const args = ffmpegInput.inputArguments.slice();
    const env = ffmpegInput.env ? { ...process.env, ...ffmpegInput.env } : undefined;

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
            const tcp = await listenZeroSingleClient('127.0.0.1');
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

                    for await (const chunk of parser.parse(socket, undefined, undefined)) {
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
    const cp = child_process.spawn(ffmpegInput.ffmpegPath || await mediaManager.getFFmpegPath(), args, {
        stdio,
        env,
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

                for await (const chunk of parser.parse(pipe as any, undefined, undefined)) {
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
        console?.log('sdp received from ffmpeg', sdp);
        sdpDeferred.resolve(sdp);
    });

    start();

    return {
        start() {
            deferredStart.resolve();
        },
        sdp: sdpDeferred.promise,
        get isActive() { return isActive },
        kill(error?: Error) {
            kill(error);
        },
        killed,
        negotiateMediaStream: (requestMediaStream: RequestMediaStreamOptions, inputVideoCodec, inputAudioCodec) => {
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
