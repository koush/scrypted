import { createServer, Socket } from 'net';
import child_process from 'child_process';
import { ChildProcess } from 'child_process';
import { FFMpegInput } from '@scrypted/sdk/types';
import { listenZeroCluster } from './listen-cluster';
import { Readable } from 'stream';
import { readLength } from './read-length';

export interface MP4Atom {
    header: Buffer;
    length: number;
    type: string;
    data: Buffer;
}

export interface FFMpegFragmentedMP4Session {
    socket: Socket;
    cp: ChildProcess;
    generator: AsyncGenerator<MP4Atom>;
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

export async function startFFMPegFragmetedMP4Session(ffmpegInput: FFMpegInput, audioOutputArgs: string[], videoOutputArgs: string[]): Promise<FFMpegFragmentedMP4Session> {
    return new Promise(async (resolve) => {
        const server = createServer(socket => {
            server.close();

            resolve({
                socket,
                cp,
                generator: parseFragmentedMP4(socket),
            });
        });
        const serverPort = await listenZeroCluster(server);

        const args = ffmpegInput.inputArguments.slice();

        args.push('-f', 'mp4');
        args.push(...videoOutputArgs);
        args.push(...audioOutputArgs);
        args.push(
            '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
            `tcp://127.0.0.1:${serverPort}`
        );

        console.log(args);

        const cp = child_process.spawn('ffmpeg', args, {
            stdio: 'ignore',
        });
        // cp.stdout.on('data', data => console.log(data.toString()));
        // cp.stderr.on('data', data => console.error(data.toString()));
    });
}
