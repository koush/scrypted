import { createServer, Server, Socket } from 'net';
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

export interface FFMpegRebroadcastSession {
    cp: ChildProcess;
    ffmpegInputs: { [container: string]: FFMpegInput };
    servers: Server[];
    inputAudioCodec?: string;
    inputVideoCodec?: string;
    inputVideoResolution?: string[];
    kill(): void;
    isActive(): boolean;
    resetActivityTimer(): void;
    events: EventEmitter;
}

export interface FFMpegRebroadcastOptions {
    parsers: { [container: string]: StreamParser };
    timeout?: number;
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

export async function startRebroadcastSession(ffmpegInput: FFMpegInput, options: FFMpegRebroadcastOptions): Promise<FFMpegRebroadcastSession> {
    let clients = 0;
    let timeout: any;
    let isActive = true;
    const events = new EventEmitter();

    let inputAudioCodec: string;
    let inputVideoCodec: string;
    let inputVideoResolution: string[];

    function kill() {
        if (isActive) {
            events.emit('killed');
        }
        isActive = false;
        cp?.kill();
        for (const server of servers) {
            server?.close();
        }
    }

    function resetActivityTimer() {
        if (!options.timeout)
            return;
        clearTimeout(timeout);
        timeout = setTimeout(kill, options.timeout);
    }

    resetActivityTimer();

    const ffmpegInputs: { [container: string]: FFMpegInput } = {};

    const args = ffmpegInput.inputArguments.slice();

    const servers = [];

    let resolve: any;
    const socketPromise = new Promise(r => resolve = r);

    for (const container of Object.keys(options.parsers)) {
        const parser = options.parsers[container];

        const eventName = container + '-data';
        const rebroadcast = createServer(socket => {
            clients++;
            console.log('rebroadcast client', clients);

            clearTimeout(timeout)

            let first = true;
            const writeData = (data: StreamChunk) => {
              if (first) {
                first = false;
                if (data.startStream) {
                  socket.write(data.startStream)
                }
              }
              socket.write(data.chunk);
            };

            const cleanup = () => {
                socket.removeAllListeners();
                events.removeListener(eventName, writeData);
                clients--;
                if (clients === 0) {
                    resetActivityTimer();
                }
                socket.destroy();
            }

            events.on(eventName, writeData);

            socket.on('end', cleanup);
            socket.on('close', cleanup);
            socket.on('error', cleanup);
        });
        servers.push(rebroadcast);

        const rebroadcastPort = await listenZeroCluster(rebroadcast);

        ffmpegInputs[container] = {
            inputArguments: [
                '-f', container,
                '-i', `tcp://127.0.0.1:${rebroadcastPort}`,
            ],
            mediaStreamOptions: ffmpegInput.mediaStreamOptions,
        };

        const server = createServer(async (socket) => {
            server.close();

            resolve(socket);

            try {
                const eventName = container + '-data';
                for await (const chunk of parser.parse(socket)) {
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

    console.log(args);

    const cp = child_process.spawn(await mediaManager.getFFmpegPath(), args);
    ffmpegLogInitialOutput(console, cp);

    cp.on('exit', kill);

    parseAudioCodec(cp).then(result => inputAudioCodec = result);
    parseVideoCodec(cp).then(result => inputVideoCodec = result);
    parseResolution(cp).then(result => inputVideoResolution = result);

    await socketPromise;

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
