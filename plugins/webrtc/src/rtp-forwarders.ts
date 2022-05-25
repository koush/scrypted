import { RtpPacket } from "@koush/werift";
import { closeQuiet, createBindZero } from "@scrypted/common/src/listen-cluster";
import { ffmpegLogInitialOutput, safeKillFFmpeg, safePrintFFmpegArguments } from "@scrypted/common/src/media-helpers";
import { parseHeaders, RtspClient } from "@scrypted/common/src/rtsp-server";
import { addTrackControls, getSpsPps, parseSdp, replacePorts, replaceSectionPort } from "@scrypted/common/src/sdp-utils";
import sdk, { FFmpegInput } from "@scrypted/sdk";
import child_process, { ChildProcess } from 'child_process';
import dgram from 'dgram';
import { Writable } from "stream";
import { H264Repacketizer } from '../../homekit/src/types/camera/h264-packetizer';

const { mediaManager } = sdk;

export function getFFmpegRtpAudioOutputArguments(inputCodec: string, maximumCompatibilityMode: boolean) {
    const ret = [
        '-vn', '-sn', '-dn',
    ];

    if (inputCodec === 'opus' && !maximumCompatibilityMode) {
        ret.push('-acodec', 'copy');
    }
    else {
        ret.push(
            '-acodec', 'libopus',
            '-application', 'lowdelay',
            '-frame_duration', '60',
            '-flags', '+global_header',
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
    codecCopy?: string;
    ffmpegDestination?: string;
    packetSize?: number;
    outputArguments: string[];
    onRtp(buffer: Buffer): void;
    firstPacket?: () => void;
    payloadType?: number;
    rtcpPort?: number;
    ssrc?: number;
    srtp?: {
        crytoSuite: string;
        key: Buffer;
    };
}

export type RtpTracks = {
    audio?: RtpTrack;
    video?: RtpTrack;
};

export type RtpSockets = {
    audio?: dgram.Socket;
    video?: dgram.Socket;
};

export async function createTrackForwarders(console: Console, rtpTracks: RtpTracks) {
    const sockets: RtpSockets = {};

    for (const key of Object.keys(rtpTracks)) {
        const track: RtpTrack = rtpTracks[key];
        const { server, port } = await createBindZero();
        sockets[key] = server;
        server.once('message', () => track.firstPacket?.());
        const outputArguments = track.outputArguments;
        if (track.payloadType)
            outputArguments.push('-payload_type', track.payloadType.toString());
        if (track.ssrc)
            outputArguments.push('-ssrc', track.ssrc.toString());

        outputArguments.push('-f', 'rtp');
        const ip = track.ffmpegDestination || '127.0.0.1';
        const params = new URLSearchParams();
        let url = `rtp://${ip}:${port}`;
        if (track.rtcpPort)
            params.set('rtcpport', track.rtcpPort.toString());
        if (track.packetSize)
            params.set('pkt_size', track.packetSize.toString());
        if (track.srtp) {
            url = `s${url}`;
            outputArguments.push(
                "-srtp_out_suite", track.srtp.crytoSuite,
                "-srtp_out_params", track.srtp.key.toString('base64'),
            );
        }
        url = `${url}?${params}`;
        outputArguments.push(url);

        server.on('message', data => track.onRtp(data));
    }

    return {
        rtpTracks,
        close() {
            for (const key of Object.keys(rtpTracks)) {
                const socket: dgram.Socket = sockets[key];
                closeQuiet(socket);
            }
        }
    }
}

export async function startRtpForwarderProcess(console: Console, ffmpegInput: FFmpegInput, rtpTracks: RtpTracks) {
    let { inputArguments, videoDecoderArguments } = ffmpegInput;
    let rtspClient: RtspClient;
    let sockets: dgram.Socket[] = [];
    let pipeSdp: string;

    if (ffmpegInput.url &&
        ffmpegInput.container?.startsWith('rtsp')
        && rtpTracks.video.codecCopy
        && rtpTracks.video.codecCopy === ffmpegInput.mediaStreamOptions?.video?.codec) {

        console.log('video codec matched:', rtpTracks.video.codecCopy);

        const { video, audio } = rtpTracks;
        delete rtpTracks.video;
        const videoCodec = video.codecCopy;
        const audioCodec = audio?.codecCopy;

        rtspClient = new RtspClient(ffmpegInput.url, console);
        rtspClient.requestTimeout = 10000;

        try {
            await rtspClient.options();
            const describe = await rtspClient.describe();
            const sdp = describe.body.toString();
            const parsedSdp = parseSdp(sdp);

            rtpTracks = Object.assign({}, rtpTracks);

            const videoSection = parsedSdp.msections.find(msection => msection.type === 'video' && msection.codec === videoCodec);
            // maybe fallback to udp forwarding/transcoding?
            if (!videoSection)
                throw new Error(`advertised video codec ${videoCodec} not found in sdp.`);

            let channel = 0;
            const h264Repacketizer = new H264Repacketizer(console, (video.packetSize - 12) || 1340, {
                ...getSpsPps(videoSection),
            });
            await rtspClient.setup({
                type: 'tcp',
                port: channel,
                path: videoSection.control,
                onRtp: (rtspHeader, rtp) => {
                    const repacketized = h264Repacketizer.repacketize(RtpPacket.deSerialize(rtp));
                    for (const packet of repacketized) {
                        video.onRtp(packet);
                    }
                },
            })
            channel += 2;

            let audioSection = parsedSdp.msections.find(msection => msection.type === 'audio' && msection.codec === audioCodec);

            if (audio) {
                if (audioSection
                    && audioCodec
                    && audio.codecCopy === ffmpegInput.mediaStreamOptions?.audio?.codec) {

                    console.log('audio codec matched:', audio.codecCopy);

                    delete rtpTracks.audio;

                    await rtspClient.setup({
                        type: 'tcp',
                        port: channel,
                        path: audioSection.control,
                        onRtp: (rtspHeader, rtp) => {
                            audio.onRtp(rtp);
                        },
                    });
                }
                else {
                    console.log('audio codec transcoding:', audio.codecCopy);
                    if (!audioSection)
                        audioSection = parsedSdp.msections.find(msection => msection.type === 'audio');

                    if (!audioSection) {
                        console.warn(`audio section not found in sdp.`);
                    }
                    else {
                        const newSdp = Object.assign({}, parsedSdp);
                        newSdp.msections = newSdp.msections.filter(msection => msection === audioSection);
                        const udpPort = Math.floor(Math.random() * 10000 + 30000);
                        pipeSdp = addTrackControls(replaceSectionPort(newSdp.toSdp(), 'audio', udpPort));

                        audio.ffmpegDestination = '127.0.0.1';
                        audio.srtp = undefined;

                        inputArguments = [
                            '-analyzeduration', '0', '-probesize', '512',
                            '-protocol_whitelist', 'pipe,udp,rtp,file,crypto,tcp',
                            '-f', 'sdp', '-i', 'pipe:3',
                        ];

                        const audioSender = await createBindZero();
                        sockets.push(audioSender.server);

                        await rtspClient.setup({
                            type: 'tcp',
                            port: channel,
                            path: audioSection.control,
                            onRtp: (rtspHeader, rtp) => {
                                audioSender.server.send(rtp, udpPort);
                            },
                        });
                    }
                }
            }

            await rtspClient.play();
        }
        catch (e) {
            rtspClient.client.destroy();
            throw e;
        }
    }
    else {
        console.log('video codec/container not matched, transcoding:', rtpTracks.audio?.codecCopy);
    }

    const forwarders = await createTrackForwarders(console, rtpTracks);

    let cp: ChildProcess;
    // will no op if there's no tracks
    if (Object.keys(rtpTracks).length) {
        const outputArguments: string[] = [];

        for (const key of Object.keys(rtpTracks)) {
            const track: RtpTrack = rtpTracks[key];
            outputArguments.push(...track.outputArguments);
        }

        const args = [
            '-hide_banner',

            ...(videoDecoderArguments || []),
            ...inputArguments,

            ...outputArguments,
        ];

        safePrintFFmpegArguments(console, args);

        cp = child_process.spawn(await mediaManager.getFFmpegPath(), args, {
            stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
        });
        if (pipeSdp) {
            const pipe = cp.stdio[3] as Writable;
            pipe.write(pipeSdp);
            pipe.end();
        }
        ffmpegLogInitialOutput(console, cp);
        cp.on('exit', () => forwarders.close());
    }

    let killed = false;
    const kill = () => {
        if (killed)
            return;
        killed = true;
        for (const socket of sockets) {
            closeQuiet(socket);
        }
        sockets = [];
        forwarders.close();
        safeKillFFmpeg(cp);
        rtspClient?.safeTeardown();
    };
    const killPromise = new Promise(resolve => {
        const resolveKill = () => {
            kill();
            resolve(undefined);
        }
        rtspClient?.client.on('close', resolveKill);
        cp?.on('exit', resolveKill);
    });

    process.nextTick(() => {
        rtspClient?.readLoop().catch(() => { }).finally(kill);
    });

    return {
        kill,
        killPromise,
        get killed() {
            return killed;
        },
        ...forwarders,
    }
}
