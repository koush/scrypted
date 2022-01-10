import { createServer, Socket } from 'net';
import child_process from 'child_process';
import { ChildProcess } from 'child_process';
import { FFMpegInput } from '@scrypted/sdk/types';
import { listenZero } from './listen-cluster';
import sdk from "@scrypted/sdk";
import { ffmpegLogInitialOutput } from './media-helpers';
import { MP4Atom, parseFragmentedMP4 } from './stream-parser';

const { mediaManager } = sdk;

export interface FFMpegFragmentedMP4Session {
    socket: Socket;
    cp: ChildProcess;
    generator: AsyncGenerator<MP4Atom>;
}

export async function startFFMPegFragmetedMP4Session(inputArguments: string[], audioOutputArgs: string[], videoOutputArgs: string[], console: Console): Promise<FFMpegFragmentedMP4Session> {
    return new Promise(async (resolve) => {
        const server = createServer(socket => {
            server.close();

            resolve({
                socket,
                cp,
                generator: parseFragmentedMP4(socket),
            });
        });
        const serverPort = await listenZero(server);

        const args = inputArguments.slice();
        args.push(
            '-f', 'mp4',
            ...videoOutputArgs,
            ...audioOutputArgs,
            '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
            `tcp://127.0.0.1:${serverPort}`
        );

        args.unshift('-hide_banner');
        console.log(args.join(' '));

        const cp = child_process.spawn(await mediaManager.getFFmpegPath(), args, {
            // stdio: 'ignore',
        });

        ffmpegLogInitialOutput(console, cp);
    });
}
