import { createServer, Server } from 'net';
import child_process from 'child_process';
import { ChildProcess } from 'child_process';
import { FFMpegInput } from '@scrypted/sdk/types';
import { listenZeroCluster } from './listen-cluster';
import { EventEmitter, once } from 'events';
import sdk from "@scrypted/sdk";

const { mediaManager } = sdk;

export interface MP4Atom {
    header: Buffer;
    length: number;
    type: string;
    data: Buffer;
}

export interface FFMpegRebroadcastSession {
    server: Server;
    cp: ChildProcess;
    ffmpegInput: FFMpegInput;
    inputAudioCodec?: string;
    inputVideoCodec?: string;
    inputVideoResolution?: string[];
    kill(): void;
    isActive(): boolean;
    resetActivityTimer(): void;
    events: EventEmitter;
}

export interface FFMpegRebroadcastOptions {
    vcodec: string[];
    acodec: string[];
    additionalOutputs?: string[];
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
    return new Promise(async (resolve) => {
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
            server?.close();
            rebroadcast?.close();
        }

        function resetActivityTimer() {
            if (!options.timeout)
                return;
            clearTimeout(timeout);
            timeout = setTimeout(kill, options.timeout);
        }

        resetActivityTimer();

        const rebroadcast = createServer(socket => {
            clients++;
            console.log('rebroadcast client', clients);

            clearTimeout(timeout)

            const data = (data: Buffer) => {
                socket.write(data);
            };
            const cleanup = () => {
                socket.removeAllListeners();
                events.removeListener('data', data);
                clients--;
                if (clients === 0) {
                    resetActivityTimer();
                }
                socket.destroy();
            }

            events.on('data', data);

            socket.on('end', cleanup);
            socket.on('close', cleanup);
            socket.on('error', cleanup);
        });

        const rebroadcastPort = await listenZeroCluster(rebroadcast);

        const server = createServer(socket => {
            server.close();

            (async() => {
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

                    const remaining = concat.length % 188;
                    const left = concat.slice(0, concat.length - remaining);
                    const right = concat.slice(concat.length - remaining);
                    pending = [right];
                    pendingSize = right.length;
                    events.emit('data', left);
                }
            })()
            .catch(e => {
                console.error('rebroadcast source ended', e);
                kill();
            });

            resolve({
                inputAudioCodec,
                inputVideoCodec,
                inputVideoResolution,

                events,
                resetActivityTimer,
                isActive() { return isActive },
                kill,
                server: rebroadcast,
                cp,
                ffmpegInput: {
                    inputArguments: [
                        '-f', 'mpegts',
                        '-i', `tcp://127.0.0.1:${rebroadcastPort}`,
                    ]
                },
            });
        });

        const serverPort = await listenZeroCluster(server);

        const args = ffmpegInput.inputArguments.slice();

        args.push(
            ...(options.additionalOutputs || []),
            '-f', 'mpegts',
            ...(options.vcodec || []),
            ...(options.acodec || []),
            `tcp://127.0.0.1:${serverPort}`
        );

        console.log(args);

        const cp = child_process.spawn(await mediaManager.getFFmpegPath(), args, {
            // stdio: 'ignore',
        });
        cp.stdout.on('data', data => console.log(data.toString()));
        cp.stderr.on('data', data => console.error(data.toString()));

        cp.on('exit', kill);

        parseAudioCodec(cp).then(result => inputAudioCodec = result);
        parseVideoCodec(cp).then(result => inputVideoCodec = result);
        parseResolution(cp).then(result => inputVideoResolution = result);
    });
}
