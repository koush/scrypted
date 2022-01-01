import { createServer, Server } from 'net';
import child_process from 'child_process';
import { ChildProcess } from 'child_process';
import { FFMpegInput } from '@scrypted/sdk/types';
import { listenZeroCluster } from './listen-cluster';
import { EventEmitter } from 'events';
import sdk from "@scrypted/sdk";
import { ffmpegLogInitialOutput } from './media-helpers';
import { StreamChunk, StreamParser } from './stream-parser';

const { mediaManager } = sdk;

export interface MP4Atom {
    header: Buffer;
    length: number;
    type: string;
    data: Buffer;
}

export interface FFMpegRebroadcastSession<T extends string> {
    cp: ChildProcess;
    ffmpegInputs: { [container in T]?: FFMpegInput };
    servers: Server[];
    inputAudioCodec?: string;
    inputVideoCodec?: string;
    inputVideoResolution?: string[];
    kill(): void;
    isActive(): boolean;
    resetActivityTimer(): void;
    events: EventEmitter;
}

export interface FFMpegRebroadcastOptions<T extends string> {
    parsers: { [container in T]?: StreamParser };
    timeout?: number;
    console: Console;
    parseOnly?: boolean;
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

export async function startRebroadcastSession<T extends string>(ffmpegInput: FFMpegInput, options: FFMpegRebroadcastOptions<T>): Promise<FFMpegRebroadcastSession<T>> {
    let clients = 0;
    let dataTimeout: NodeJS.Timeout;
    let ffmpegIncomingConnectionTimeout: NodeJS.Timeout;
    let isActive = true;
    const events = new EventEmitter();
    events.on('error', e => console.error('rebroadcast error', e));
    const { console } = options;

    let inputAudioCodec: string;
    let inputVideoCodec: string;
    let inputVideoResolution: string[];

    let resolve: any;
    let reject: any;
    const socketPromise = new Promise((r, rj) => {
        resolve = r;
        reject = rj;
    });

    function kill() {
        if (isActive) {
            events.emit('killed');
            events.emit('error', new Error('killed'));
        }
        isActive = false;
        cp?.kill();
        for (const server of servers) {
            server?.close();
        }
        reject(new Error('ffmpeg was killed before connecting to the rebroadcast session'));
        clearTimeout(dataTimeout);
        clearTimeout(ffmpegIncomingConnectionTimeout);
    }

    function resetActivityTimer() {
        if (!options.timeout)
            return;
        clearTimeout(dataTimeout);
        dataTimeout = setTimeout(kill, options.timeout);
    }

    resetActivityTimer();

    const ffmpegInputs: { [container in T]: FFMpegInput } = {} as any;

    const args = ffmpegInput.inputArguments.slice();

    const servers = [];

    ffmpegIncomingConnectionTimeout = setTimeout(kill, 30000);

    for (const container of Object.keys(options.parsers)) {
        const parser = options.parsers[container];

        const eventName = container + '-data';

        if (!options.parseOnly) {
            const {server: rebroadcast, port: rebroadcastPort } = await createRebroadcaster({
                connect: (writeData, destroy) => {
                    clients++;
                    clearTimeout(dataTimeout);

                    const cleanup = () => {
                        events.removeListener(eventName, writeData);
                        events.removeListener('killed', destroy)
                        clients--;
                        if (clients === 0) {
                            resetActivityTimer();
                        }
                        destroy();
                    }
                    events.on(eventName, writeData);
                    events.once('killed', cleanup);

                    return cleanup;
                }
            })

            servers.push(rebroadcast);

            const url = `tcp://127.0.0.1:${rebroadcastPort}`;
            ffmpegInputs[container] = {
                url,
                mediaStreamOptions: ffmpegInput.mediaStreamOptions,
                inputArguments: [
                    '-f', container,
                    '-i', url,
                ],
            };
        }
        else {
            ffmpegInputs[container] = {
                url: undefined,
                mediaStreamOptions: ffmpegInput.mediaStreamOptions,
            };
        }

        const server = createServer(async (socket) => {
            server.close();

            resolve(socket);

            try {
                const eventName = container + '-data';
                for await (const chunk of parser.parse(socket, parseInt(inputVideoResolution?.[2]), parseInt(inputVideoResolution?.[3]))) {
                    events.emit(eventName, chunk);
                }
            }
            catch (e) {
                console.error('rebroadcast parse error', e);
                kill();
            }
        });
        servers.push(server);

        const serverPort = await listenZeroCluster(server);

        args.push(
            ...parser.outputArguments,
            `tcp://127.0.0.1:${serverPort}`
        );
    }

    args.unshift('-hide_banner');
    console.log(args.join(' '));
    const cp = child_process.spawn(await mediaManager.getFFmpegPath(), args);
    ffmpegLogInitialOutput(console, cp);

    cp.on('exit', kill);

    parseAudioCodec(cp).then(result => inputAudioCodec = result);
    parseVideoCodec(cp).then(result => inputVideoCodec = result);
    parseResolution(cp).then(result => inputVideoResolution = result);

    await socketPromise;
    clearTimeout(ffmpegIncomingConnectionTimeout);

    return {
        inputAudioCodec,
        inputVideoCodec,
        inputVideoResolution,

        events,
        resetActivityTimer,
        isActive() { return isActive },
        kill,
        servers,
        cp,
        ffmpegInputs,
    };
}

export interface Rebroadcaster {
    server: Server;
    port: number;
}

export interface RebroadcastSessionCleanup {
    (): void;
}

export interface RebroadcasterOptions {
    connect?: (writeData: (data: StreamChunk) => number, cleanup: () => void) => RebroadcastSessionCleanup|undefined;
}

export async function createRebroadcaster(options?: RebroadcasterOptions): Promise<Rebroadcaster> {
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

        socket.on('end', cleanup);
        socket.on('close', cleanup);
        socket.on('error', cleanup);
    });
    const port = await listenZeroCluster(server);
    return {
        server,
        port,
    }
}