import child_process from 'child_process';
import { ChildProcess } from 'child_process';
import sdk from "@scrypted/sdk";
import { ffmpegLogInitialOutput, safePrintFFmpegArguments } from './media-helpers';
import { MP4Atom, parseFragmentedMP4 } from './stream-parser';
import { Duplex, Readable } from 'stream';

const { mediaManager } = sdk;

export interface FFMpegFragmentedMP4Session {
    cp: ChildProcess;
    generator: AsyncGenerator<MP4Atom>;
}

export async function startFFMPegFragmentedMP4Session(inputArguments: string[], audioOutputArgs: string[], videoOutputArgs: string[], console: Console): Promise<FFMpegFragmentedMP4Session> {
    const args = inputArguments.slice();
    args.push(
        ...videoOutputArgs,
        ...audioOutputArgs,
        '-movflags', 'frag_keyframe+empty_moov+default_base_moof+skip_sidx+skip_trailer',
        '-f', 'mp4',
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
