import child_process from 'child_process';
import { ChildProcess } from 'child_process';
import sdk from "@scrypted/sdk";
import { ffmpegLogInitialOutput, safePrintFFmpegArguments } from './media-helpers';
import { Readable } from 'stream';
import { readLength } from './read-stream';

const { mediaManager } = sdk;

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

export interface MP4Atom {
    header: Buffer;
    length: number;
    type: string;
    data: Buffer;
}

export const FFMPEG_FRAGMENTED_MP4_OUTPUT_ARGS = [
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof+skip_sidx+skip_trailer',
    '-f', 'mp4',
];

export interface FFmpegFragmentedMP4Session {
    cp: ChildProcess;
    generator: AsyncGenerator<MP4Atom>;
}

export async function startFFMPegFragmentedMP4Session(inputArguments: string[], audioOutputArgs: string[], videoOutputArgs: string[], console: Console): Promise<FFmpegFragmentedMP4Session> {
    const args = inputArguments.slice();
    args.push(
        ...videoOutputArgs,
        ...audioOutputArgs,
        ...FFMPEG_FRAGMENTED_MP4_OUTPUT_ARGS,
        'pipe:3',
    );

    args.unshift('-hide_banner');
    safePrintFFmpegArguments(console, args);

    const cp = child_process.spawn(await mediaManager.getFFmpegPath(), args, {
        stdio: ['pipe', 'pipe', 'pipe', 'pipe',]
    });

    ffmpegLogInitialOutput(console, cp);

    return {
        cp,
        generator: parseFragmentedMP4(cp.stdio[3] as Readable),
    };
}
