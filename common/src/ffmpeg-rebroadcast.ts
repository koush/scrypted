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
}

export interface FFMpegRebroadcastOptions {
    vcodec: string;
    acodec: string;
}

export async function startRebroadcastSession(ffmpegInput: FFMpegInput, options: FFMpegRebroadcastOptions): Promise<FFMpegRebroadcastSession> {
    return new Promise(async (resolve) => {
        let clients = 0;
        let timeout: any;
        const startTimeout = () => {
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                cp?.kill();
                server?.close();
                rebroadcast?.close();
            }, 30000);
        }
        startTimeout();

        const events = new EventEmitter();

        const rebroadcast = createServer(socket => {
            console.log('rebroadcast client');
            clients++;

            clearTimeout(timeout)

            const data = (data: Buffer) => {
                socket.write(data);
            };
            const cleanup = () => {
                socket.removeAllListeners();
                events.removeListener('data', data);
                clients--;
                if (clients === 0) {
                    startTimeout();
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
            '-vcodec', options.vcodec,
            ...(options.acodec ? ['-acodec', options.acodec] : ['-an']),
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
