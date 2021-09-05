import { createServer, Socket, Server } from 'net';
import child_process from 'child_process';
import { ChildProcess } from 'child_process';
import { FFMpegInput } from '@scrypted/sdk/types';
import { listenZeroCluster } from './listen-cluster';
import { readLength } from './read-length';
import { EventEmitter } from 'events';

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
    kill(): void;
    isActive(): boolean;
    resetActivityTimer(): void;
    events: EventEmitter;
}

export interface FFMpegRebroadcastOptions {
    vcodec: string[];
    acodec: string[];
}

export async function startRebroadcastSession(ffmpegInput: FFMpegInput, options: FFMpegRebroadcastOptions): Promise<FFMpegRebroadcastSession> {
    return new Promise(async (resolve) => {
        let clients = 0;
        let timeout: any;
        let isActive = true;
        const events = new EventEmitter();

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
            clearTimeout(timeout);
            timeout = setTimeout(kill, 30000);
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
                while (true) {
                    const data = await readLength(socket, 188);
                    events.emit('data', data);
                }
            })();

            resolve({
                events,
                resetActivityTimer,
                isActive() { return isActive },
                kill,
                server: rebroadcast,
                cp,
                ffmpegInput: {
                    inputArguments: [
                        '-f',
                        'mpegts',
                        '-i',
                        `tcp://127.0.0.1:${rebroadcastPort}`
                    ]
                },
            });
        });

        const serverPort = await listenZeroCluster(server);

        const args = ffmpegInput.inputArguments.slice();

        args.push(
            '-f', 'mpegts',
            ...(options.vcodec || []),
            ...(options.acodec || []),
            `tcp://127.0.0.1:${serverPort}`
        );

        console.log(args);

        const cp = child_process.spawn('ffmpeg', args, {
            // stdio: 'ignore',
        });
        cp.stdout.on('data', data => console.log(data.toString()));
        cp.stderr.on('data', data => console.error(data.toString()));

    });
}
