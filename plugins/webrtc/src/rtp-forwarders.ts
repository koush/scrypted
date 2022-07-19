import { closeQuiet, createBindZero } from "@scrypted/common/src/listen-cluster";
import { ffmpegLogInitialOutput, safeKillFFmpeg, safePrintFFmpegArguments } from "@scrypted/common/src/media-helpers";
import { RtspClient } from "@scrypted/common/src/rtsp-server";
import { addTrackControls, MSection, parseSdp, replaceSectionPort } from "@scrypted/common/src/sdp-utils";
import sdk, { FFmpegInput } from "@scrypted/sdk";
import child_process, { ChildProcess } from 'child_process';
import dgram from 'dgram';
import { Writable } from "stream";

const { mediaManager } = sdk;

export interface RtpTrack {
    codecCopy?: string;
    ffmpegDestination?: string;
    packetSize?: number;
    outputArguments: string[];
    onRtp(rtp: Buffer): void;
    onMSection?: (msection: MSection) => void;
    firstPacket?: () => void;
    payloadType?: number;
    rtcpPort?: number;
    ssrc?: number;
    srtp?: {
        crytoSuite: string;
        key: Buffer;
    };
    bind?: Awaited<ReturnType<typeof createBindZero>>;
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
        track.bind = await createBindZero();
        const { server, port } = track.bind;
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

function isCodecCopy(desiredCodec: string, checkCodec: string) {
    return desiredCodec === 'copy'
        || (desiredCodec && desiredCodec === checkCodec);
}

export type RtpForwarderProcess = Awaited<ReturnType<typeof startRtpForwarderProcess>>;

export async function startRtpForwarderProcess(console: Console, ffmpegInput: FFmpegInput, rtpTracks: RtpTracks) {
    let { inputArguments, videoDecoderArguments } = ffmpegInput;
    let rtspClient: RtspClient;
    let sockets: dgram.Socket[] = [];
    let pipeSdp: string;

    const { video, audio } = rtpTracks;
    const videoCodec = video.codecCopy;
    const audioCodec = audio?.codecCopy;

    let videoSection: MSection;
    let audioSection: MSection;

    const isRtsp = ffmpegInput.container?.startsWith('rtsp');

    if (ffmpegInput.url
        && isRtsp
        && isCodecCopy(videoCodec, ffmpegInput.mediaStreamOptions?.video?.codec)) {

        console.log('video codec matched:', rtpTracks.video.codecCopy);

        delete rtpTracks.video;

        rtspClient = new RtspClient(ffmpegInput.url, console);
        rtspClient.requestTimeout = 10000;

        try {
            await rtspClient.options();
            const describe = await rtspClient.describe();
            const sdp = describe.body.toString();
            const parsedSdp = parseSdp(sdp);

            rtpTracks = Object.assign({}, rtpTracks);

            videoSection = parsedSdp.msections.find(msection => msection.type === 'video' && (msection.codec === videoCodec || videoCodec === 'copy'));
            // maybe fallback to udp forwarding/transcoding?
            if (!videoSection)
                throw new Error(`advertised video codec ${videoCodec} not found in sdp.`);

            video.onMSection?.(videoSection);

            let channel = 0;
            await rtspClient.setup({
                type: 'tcp',
                port: channel,
                path: videoSection.control,
                onRtp: (rtspHeader, rtp) => {
                    video.onRtp(rtp);
                },
            })
            channel += 2;

            audioSection = parsedSdp.msections.find(msection => msection.type === 'audio' && (msection.codec === audioCodec || audioCodec === 'copy'));

            if (audio) {
                if (audioSection
                    && isCodecCopy(audioCodec, audioSection?.codec)) {

                    console.log('audio codec matched:', audio.codecCopy);

                    delete rtpTracks.audio;

                    audio.onMSection?.(audioSection);

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

                    const newSdp = parseSdp(sdp);
                    audioSection = newSdp.msections.find(msection => msection.type === 'audio' && msection.codec === audioCodec)
                    if (!audioSection)
                        audioSection = newSdp.msections.find(msection => msection.type === 'audio');

                    if (!audioSection) {
                        console.warn(`audio section not found in sdp.`);
                    }
                    else {
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

                        audio.onMSection?.(audioSection);

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

    const useGstreamer = false && isRtsp;

    let cp: ChildProcess;
    // will no op if there's no tracks
    if (Object.keys(rtpTracks).length) {
        if (useGstreamer) {
            const args = [
                // '-v',
                // 'fdsrc', 'fd=3', 'do-timestamp=true', '!',
                // 'queue', '!',
                // 'application/x-rtp-stream,media=video,clock-rate=90000,encoding-name=H264', '!', 'rtpstreamdepay', '!',
                // '-v',
                'rtspsrc', `location=${ffmpegInput.url}`,
                'protocols=tcp',
                // 'buffer-mode=0',
                'latency=0',
                'do-retransmission=0', 'do-rtcp=false', 'do-rtsp-keep-alive=false',
                // 'debug=true',
                // 'name=src','src.', '!',
                '!',
                'queue', '!',
                'rtpjitterbuffer',
                // 'mode=0',
                'latency=0',
                'max-dropout-time=0', 'faststart-min-packets=1', 'max-misorder-time=0',
                '!',
                'queue', '!',
                'rtph264depay', '!',
                'queue', '!',
                'h264parse', '!',

                'decodebin', '!',
                'videorate', 'max-rate=15', '!', 'video/x-raw,framerate=15/1', '!',
                'queue', 'max-size-buffers=1', 'leaky=upstream', '!',
                'queue', '!',
                'x264enc', 'aud=false', 'bitrate=2000', 'speed-preset=ultrafast',
                'bframes=0',
                'key-int-max=60',
                // 'tune=zerolatency',
                '!',
                'queue', '!',

                'h264parse', '!',
                'queue', '!',

                'rtph264pay', 'aggregate-mode=max-stap', 'config-interval=-1', `mtu=${rtpTracks.video.packetSize.toString()}`, '!',
                'queue', '!',
                'udpsink', 'host=127.0.0.1', `port=${rtpTracks.video.bind.port}`, 'sync=false',
                // 'src.', '!', 'decodebin', '!',  'rtpopuspay', '!', 'udpsink', 'host=127.0.0.1', `port=${rtpTracks.audio.bind.port}`, 'sync=false',
            ];


            safePrintFFmpegArguments(console, args);

            cp = child_process.spawn('gst-launch-1.0', args, {
                stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
            });
            ffmpegLogInitialOutput(console, cp, true);
            cp.on('exit', () => forwarders.close());


            // rtspClient = new RtspClient(ffmpegInput.url, console);
            // rtspClient.requestTimeout = 10000;

            // await rtspClient.options();
            // const describe = await rtspClient.describe();
            // const sdp = describe.body.toString();
            // const parsedSdp = parseSdp(sdp);

            // rtpTracks = Object.assign({}, rtpTracks);

            // videoSection = parsedSdp.msections.find(msection => msection.type === 'video');
            // // maybe fallback to udp forwarding/transcoding?
            // if (!videoSection)
            //     throw new Error(`advertised video codec ${videoCodec} not found in sdp.`);

            // const pipe = cp.stdio[3] as Writable;
            // let channel = 0;
            // await rtspClient.setup({
            //     type: 'tcp',
            //     port: channel,
            //     path: videoSection.control,
            //     onRtp: (rtspHeader, rtp) => {
            //         pipe.write(rtspHeader.subarray(2));
            //         pipe.write(rtp);
            //     },
            // })

            // await rtspClient.play();

        }
        else {
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
                '-sdp_file', 'pipe:4',
            ];

            safePrintFFmpegArguments(console, args);

            cp = child_process.spawn(await mediaManager.getFFmpegPath(), args, {
                stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
            });
            if (pipeSdp) {
                const pipe = cp.stdio[3] as Writable;
                pipe.write(pipeSdp);
                pipe.end();
            }
            ffmpegLogInitialOutput(console, cp);
            cp.on('exit', () => forwarders.close());
        }
    }
    else {
        console.log('bypassing ffmpeg, perfect codecs');
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

    if (!useGstreamer && Object.keys(rtpTracks).length) {
        const transcodeSdp = await new Promise<string>((resolve, reject) => {
            cp.on('exit', () => reject(new Error('ffmpeg exited before sdp was received')));
            cp.stdio[4].on('data', data => {
                resolve(data.toString());
            });
        });
        const parsedSdp = parseSdp(transcodeSdp);
        videoSection = parsedSdp.msections.find(msection => msection.type === 'video') || videoSection;
        audioSection = parsedSdp.msections.find(msection => msection.type === 'audio') || audioSection;
    }

    return {
        videoSection,
        audioSection,
        kill,
        killPromise,
        get killed() {
            return killed;
        },
        ...forwarders,
    }
}
