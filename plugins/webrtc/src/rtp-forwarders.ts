import { RTCRtpTransceiver } from "@koush/werift";
import { closeQuiet, createBindZero } from "@scrypted/common/src/listen-cluster";
import { ffmpegLogInitialOutput, safePrintFFmpegArguments } from "@scrypted/common/src/media-helpers";
import sdk from "@scrypted/sdk";
import child_process from 'child_process';
import dgram from 'dgram';

const { mediaManager } = sdk;

export function getFFmpegRtpAudioOutputArguments(inputCodec: string) {
    const ret = [
        '-vn', '-sn', '-dn',
    ];

    if (inputCodec === 'opus') {
        ret.push('-acodec', 'copy');
    }
    else {
        ret.push(
            '-acodec', 'libopus',
            '-application', 'lowdelay',
            '-frame_duration', '60',
            '-flags' ,'+global_header',
            '-ar', '48k',
            // choose a better birate? this is on the high end recommendation for voice.
            '-b:a', '40k',
            '-bufsize', '96k',
            '-ac', '2',
        )
    }
    return ret;
}

export interface RtpTrack {
    outputArguments: string[];
    transceiver: RTCRtpTransceiver;
    onRtp?(buffer: Buffer): Buffer;
    firstPacket?: () => void;
}

export type RtpTracks<T extends string> = {
    [key in T]: RtpTrack;
};

export type RtpSockets<T extends string> = {
    [key in T]?: dgram.Socket;
};

export async function createTrackForwarders<T extends string>(console: Console, rtpTracks: RtpTracks<T>) {
    const sockets: RtpSockets<T> = {};

    for (const key of Object.keys(rtpTracks)) {
        const { server, port } = await createBindZero();
        sockets[key as T] = server;
        const track = rtpTracks[key as T];
        server.once('message', () => track.firstPacket?.());
        const outputArguments = track.outputArguments;
        outputArguments.push(
            '-f', 'rtp', `rtp://127.0.0.1:${port}`,
        );

        if (track.onRtp) {
            server.on('message', data => {
                data = track.onRtp(data);
                track.transceiver.sender.sendRtp(data);
            });
        }
        else {
            server.on('message', data => track.transceiver.sender.sendRtp(data));
        }
    }

    return {
        rtpTracks,
        close() {
            for (const key of Object.keys(rtpTracks)) {
                const socket = sockets[key as T];
                closeQuiet(socket);
            }
        }
    }
}

export async function startRtpForwarderProcess<T extends string>(console: Console, inputArguments: string[], rtpTracks: RtpTracks<T>, options?: child_process.SpawnOptionsWithoutStdio) {
    const forwarders = await createTrackForwarders(console, rtpTracks);

    const outputArguments: string[] = [];

    for (const key of Object.keys(rtpTracks)) {
        outputArguments.push(

        )
        outputArguments.push(...rtpTracks[key as T].outputArguments);
    }

    const args = [
        '-hide_banner',

        ...inputArguments,

        // create a dummy audio track if none actually exists.
        // this track will only be used if no audio track is available.
        // https://stackoverflow.com/questions/37862432/ffmpeg-output-silent-audio-track-if-source-has-no-audio-or-audio-is-shorter-th
        '-f', 'lavfi', '-i', 'anullsrc=cl=1', '-shortest',

        ...outputArguments,
    ];

    safePrintFFmpegArguments(console, args);

    const cp = child_process.spawn(await mediaManager.getFFmpegPath(), args, options);
    ffmpegLogInitialOutput(console, cp);
    cp.on('exit', () => forwarders.close());

    return {
        cp,
        ...forwarders,
    }
}
