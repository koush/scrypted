import { Deferred } from "@scrypted/common/src/deferred";
import { closeQuiet, createBindZero, listenZeroSingleClient } from "@scrypted/common/src/listen-cluster";
import { ffmpegLogInitialOutput, safeKillFFmpeg, safePrintFFmpegArguments } from "@scrypted/common/src/media-helpers";
import { RtspClient, RtspServer, RtspServerResponse, RtspStatusError } from "@scrypted/common/src/rtsp-server";
import { MSection, addTrackControls, parseSdp, replaceSectionPort } from "@scrypted/common/src/sdp-utils";
import sdk, { FFmpegInput } from "@scrypted/sdk";
import child_process, { ChildProcess } from 'child_process';
import dgram from 'dgram';
import { Writable } from "stream";
import { RtpPacket } from "../../../external/werift/packages/rtp/src/rtp/rtp";

const { mediaManager } = sdk;

type StringWithAutocomplete<T> = T | (string & Record<never, never>);

export type RtpCodecCopy = StringWithAutocomplete<"copy">;

export interface RtpTrack {
    codecCopy?: RtpCodecCopy;
    ffmpegDestination?: string;
    packetSize?: number;
    encoderArguments: string[];
    outputArguments?: string[];
    onRtp(rtp: Buffer): void;
    onMSection?: (msection: MSection) => void;
    firstPacket?: (rtp: Buffer) => void;
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

function createPacketDelivery(track: RtpTrack) {
    const original = track.onRtp;
    track.onRtp = rtp => {
        track.onRtp = original;
        track.firstPacket?.(rtp);
        track.onRtp(rtp);
    }

    return (rtp: Buffer) => track.onRtp(rtp);
}

function attachTrackDgram(track: RtpTrack, server: dgram.Socket) {
    server?.on('message', createPacketDelivery(track));
}

async function setupRtspClient(console: Console, rtspClient: RtspClient, channel: number, section: MSection, rtspClientForceTcp: boolean, deliver: ReturnType<typeof createPacketDelivery>) {
    try {
        if (!rtspClientForceTcp) {
            const result = await rtspClient.setup({
                type: 'udp',
                path: section.control,
                onRtp: (rtspHeader, rtp) => deliver(rtp),
            });
            console.log('rtsp/udp', section.codec, result);
            return false;
        }
    }
    catch (e) {
        if (!(e instanceof RtspStatusError))
            throw e;
    }
    await rtspClient.setup({
        type: 'tcp',
        port: channel,
        path: section.control,
        onRtp: (rtspHeader, rtp) => deliver(rtp),
    });
    console.log('rtsp/tcp', section.codec);
    return true;
}

async function createTrackForwarders(console: Console, killDeferred: Deferred<void>, rtpTracks: RtpTracks) {

    for (const key of Object.keys(rtpTracks)) {
        const track: RtpTrack = rtpTracks[key];
        track.bind = await createBindZero();
        track.bind.server.setRecvBufferSize(1024 * 1024);
        const { server, port } = track.bind;
        killDeferred.promise.finally(() => closeQuiet(server));
        const outputArguments = track.outputArguments = [];
        if (track.payloadType)
            outputArguments.push('-payload_type', track.payloadType.toString());
        if (track.ssrc)
            outputArguments.push('-ssrc', track.ssrc.toString());

        attachTrackDgram(track, server);
    }
}

function isCodecCopy(desiredCodec: RtpCodecCopy, checkCodec: string) {
    return desiredCodec === 'copy'
        || (desiredCodec && desiredCodec === checkCodec);
}

export type RtpForwarderProcess = Awaited<ReturnType<typeof startRtpForwarderProcess>>;

export async function startRtpForwarderProcess(console: Console, ffmpegInput: FFmpegInput, rtpTracks: RtpTracks, options?: {
    rtspClientForceTcp?: boolean,
    rtspMode?: 'udp' | 'tcp' | 'pull',
    onRtspClient?: (rtspClient: RtspClient, optionsResponse: RtspServerResponse) => Promise<boolean>,
}) {
    if (!rtpTracks.audio)
        delete rtpTracks.audio;
    if (!rtpTracks.video)
        delete rtpTracks.video;

    const killDeferred = new Deferred<void>();

    const killGuard = (track: RtpTrack) => {
        const old = track?.onRtp;
        if (old) {
            track.onRtp = rtp => {
                if (killDeferred.finished)
                    return;
                const payloadType = rtp.readUint8(1) & 0x7f;
                // ignore rtcp.
                if (payloadType >= 72 && payloadType <= 76)
                    return;
                old(rtp);
            }
        }
    }
    killGuard(rtpTracks.video);
    killGuard(rtpTracks.audio);

    let { inputArguments, videoDecoderArguments } = ffmpegInput;
    let rtspClient: RtspClient;
    killDeferred.promise.finally(() => rtspClient?.safeTeardown());
    let pipeSdp: string;

    let rtspClientHooked = false;
    const { rtspMode, onRtspClient, rtspClientForceTcp } = options || {};
    const { video, audio } = rtpTracks;
    rtpTracks = Object.assign({}, rtpTracks);
    const videoCodec = video?.codecCopy;
    const audioCodec = audio?.codecCopy;
    const ffmpegPath = await mediaManager.getFFmpegPath();

    const isRtsp = ffmpegInput.container?.startsWith('rtsp');

    let rtspSdp: string;
    const sdpDeferred = new Deferred<string>();
    const videoSectionDeferred = new Deferred<MSection>();
    const audioSectionDeferred = new Deferred<MSection>();
    videoSectionDeferred.promise.then(s => video?.onMSection?.(s));
    audioSectionDeferred.promise.then(s => audio?.onMSection?.(s));
    let allowAudioTranscoderExit = false;

    if (ffmpegInput.url
        && isRtsp
        && isCodecCopy(videoCodec, ffmpegInput.mediaStreamOptions?.video?.codec)) {

        // console.log('video codec matched:', rtpTracks.video.codecCopy);

        delete rtpTracks.video;

        rtspClient = new RtspClient(ffmpegInput.url);
        rtspClient.requestTimeout = 10000;

        try {
            const optionsResponse = await rtspClient.options();
            const describe = await rtspClient.describe();
            rtspSdp = describe.body.toString();
            const parsedSdp = parseSdp(rtspSdp);

            const videoSection = parsedSdp.msections.find(msection => msection.type === 'video' && (msection.codec === videoCodec || videoCodec === 'copy'));
            // maybe fallback to udp forwarding/transcoding?
            if (!videoSection)
                throw new Error(`advertised video codec ${videoCodec} not found in sdp.`);

            if (!videoSection.codec) {
                console.warn('Unable to determine sdpvideo codec? Please report this to @koush on Discord.');
                console.warn(rtspSdp);
            }

            videoSectionDeferred.resolve(videoSection);

            let channel = 0;
            await setupRtspClient(console, rtspClient, channel, videoSection, rtspClientForceTcp, createPacketDelivery(video));
            channel += 2;

            const audioSection = parsedSdp.msections.find(msection => msection.type === 'audio' && (msection.codec === audioCodec || audioCodec === 'copy'));

            console.log('a/v', videoCodec, audioCodec, 'found', videoSection.codec, audioSection?.codec);

            if (audio) {
                if (audioSection
                    && isCodecCopy(audioCodec, audioSection?.codec)) {

                    // console.log('audio codec matched:', audio.codecCopy);

                    delete rtpTracks.audio;

                    audioSectionDeferred.resolve(audioSection);

                    await setupRtspClient(console, rtspClient, channel, audioSection, rtspClientForceTcp, createPacketDelivery(audio));
                    channel += 2;
                }
                else {
                    // console.log('audio codec transcoding:', audio.codecCopy);

                    const newSdp = parseSdp(rtspSdp);
                    let audioSection = newSdp.msections.find(msection => msection.type === 'audio' && msection.codec === audioCodec)
                    if (!audioSection)
                        audioSection = newSdp.msections.find(msection => msection.type === 'audio');

                    if (!audioSection) {
                        delete rtpTracks.audio;
                        console.warn(`audio section not found in sdp.`);
                        audioSectionDeferred.resolve(undefined);
                    }
                    else {
                        newSdp.msections = newSdp.msections.filter(msection => msection === audioSection);
                        const audioSdp = addTrackControls(replaceSectionPort(newSdp.toSdp(), 'audio', 0));
                        const parsedAudioSdp = parseSdp(audioSdp);
                        const audioControl = parsedAudioSdp.msections.find(msection => msection.type === 'audio').control;

                        let firstPacket = true;
                        let adts = false;

                        // if the rtsp client is over tcp, then the restream server must also be tcp, as
                        // the rtp packets (which can be a max of 64k) may be too large for udp.
                        const clientIsTcp = await setupRtspClient(console, rtspClient, channel, audioSection, false, rtp => {
                            // live555 sends rtp aac packets without AU header followed by ADTS packets (which contain codec info)
                            // which ffmpeg can not handle.
                            // the solution is to demux the adts and send that to ffmpeg raw.
                            // https://github.com/mpv-player/mpv/issues/5669#issuecomment-932519409
                            if (firstPacket) {
                                firstPacket = false;
                                if (audioSection.codec === 'aac') {
                                    const packet = RtpPacket.deSerialize(rtp);
                                    const buf = packet.payload;
                                    // adts header is 12 bits of 1s
                                    if (buf[0] == 0xff && (buf[1] & 0xf0) == 0xf0) {
                                        adts = true;
                                        allowAudioTranscoderExit = true;
                                        const ffmpegArgs = [
                                            '-hide_banner',
                                            '-f', 'aac',
                                            '-i', 'pipe:3',
                                            ...audio.encoderArguments,
                                            ...audio.outputArguments,
                                        ];

                                        safePrintFFmpegArguments(console, ffmpegArgs);
                                        const cp = child_process.spawn(ffmpegPath, ffmpegArgs, {
                                            stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
                                        });
                                        ffmpegLogInitialOutput(console, cp);
                                        killDeferred.promise.finally(() => safeKillFFmpeg(cp));
                                        cp.on('exit', () => killDeferred.resolve(undefined));

                                        audioPipe = cp.stdio[3] as Writable;
                                    }
                                }
                            }

                            if (!adts) {
                                rtspServer?.sendTrack(audioControl, rtp, false);
                            }
                            else {
                                const packet = RtpPacket.deSerialize(rtp);
                                audioPipe?.write(packet.payload);
                            }
                        });

                        const audioClient = await listenZeroSingleClient();
                        let audioPipe: Writable;
                        killDeferred.promise.finally(() => audioClient.clientPromise.then(client => client.destroy()));
                        let rtspServer: RtspServer;
                        audioClient.clientPromise.then(async client => {
                            const r = new RtspServer(client, audioSdp, !clientIsTcp);
                            killDeferred.promise.finally(() => rtspServer.destroy());
                            await r.handlePlayback();
                            rtspServer = r;
                        });

                        audio.ffmpegDestination = '127.0.0.1';
                        audio.srtp = undefined;

                        inputArguments = [
                            '-i', `rtsp://${audioClient.host}:${audioClient.port}`,
                        ];
                    }
                }
            }
            else {
                audioSectionDeferred.resolve(undefined);
            }

            rtspClientHooked = await onRtspClient?.(rtspClient, optionsResponse);
            if (!rtspClientHooked)
                await rtspClient.play();
        }
        catch (e) {
            rtspClient.client.destroy();
            throw e;
        }
    }
    else {
        console.log('video codec/container not matched, transcoding:', videoCodec, JSON.stringify(ffmpegInput));
    }

    const reportTranscodedSections = (sdp: string) => {
        sdpDeferred.resolve(sdp);
        const parsedSdp = parseSdp(sdp);
        const videoSection = parsedSdp.msections.find(msection => msection.type === 'video');
        const audioSection = parsedSdp.msections.find(msection => msection.type === 'audio');

        videoSectionDeferred.resolve(videoSection);
        audioSectionDeferred.resolve(audioSection);

        return { videoSection, audioSection };
    }

    await createTrackForwarders(console, killDeferred, rtpTracks);

    rtspClient?.client.on('close', () => killDeferred.resolve(undefined));

    const useRtp = !rtspMode;
    const rtspServerDeferred = new Deferred<RtspServer>();

    // will no op if there's no tracks
    let cp: ChildProcess;
    if (Object.keys(rtpTracks).length) {
        if (useRtp) {
            rtspServerDeferred.resolve(undefined);

            for (const key of Object.keys(rtpTracks)) {
                const track: RtpTrack = rtpTracks[key];

                let destination = track.ffmpegDestination || '127.0.0.1';
                if (destination === '127.0.0.1')
                    destination = `${destination}:${track.bind.port}`;
                const params = new URLSearchParams();
                let url = `rtp://${destination}`;
                if (track.rtcpPort)
                    params.set('rtcpport', track.rtcpPort.toString());
                if (track.packetSize)
                    params.set('pkt_size', track.packetSize.toString());
                if (track.srtp) {
                    url = `s${url}`;
                    track.outputArguments.push(
                        "-srtp_out_suite", track.srtp.crytoSuite,
                        "-srtp_out_params", track.srtp.key.toString('base64'),
                    );
                }
                url = `${url}?${params}`;

                track.outputArguments.push('-dn', '-sn');
                if (key !== 'video')
                    track.outputArguments.push('-vn');
                if (key !== 'audio')
                    track.outputArguments.push('-an');
                track.outputArguments.push('-f', 'rtp');
                track.outputArguments.push(url);
            }
        }

        const outputArguments: string[] = [];

        for (const key of Object.keys(rtpTracks)) {
            const track: RtpTrack = rtpTracks[key];
            outputArguments.push(...track.encoderArguments, ...track.outputArguments);
        }

        const args = [
            '-hide_banner',

            ...(videoDecoderArguments || []),
            ...inputArguments,
            ...outputArguments,
        ];

        if (useRtp) {
            args.push(
                '-sdp_file', 'pipe:4',
            );
        }
        else {
            // seems better to use udp for audio timing/chop.
            const useUdp = rtspMode === 'udp';

            const serverPort = await listenZeroSingleClient();

            args.push(
                '-rtsp_transport',
                useUdp ? 'udp' : 'tcp',
                '-f', 'rtsp',
                `rtsp://127.0.0.1:${serverPort.port}`
            );

            serverPort.clientPromise.then(async (client) => {
                client.on('close', () => killDeferred.resolve(undefined));
                killDeferred.promise.finally(() => client.destroy());

                const rtspServer = new RtspServer(client, undefined, useUdp);
                // rtspServer.console = console;

                await rtspServer.handleSetup(['announce']);
                const { videoSection, audioSection } = reportTranscodedSections(rtspServer.sdp);
                await rtspServer.handleSetup();

                attachTrackDgram(video, rtspServer.setupTracks[videoSection?.control]?.rtp);
                attachTrackDgram(audio, rtspServer.setupTracks[audioSection?.control]?.rtp);

                rtspServerDeferred.resolve(rtspServer);

                if (rtspMode !== 'pull') {
                    let firstVideoPacket = true;
                    let firstAudioPacket = true;
                    for await (const rtspSample of rtspServer.handleRecord()) {
                        if (rtspSample.type === videoSection.codec) {
                            if (firstVideoPacket) {
                                firstVideoPacket = false;
                                video.firstPacket?.(rtspSample.packet);
                            }
                            video.onRtp(rtspSample.packet);
                        }
                        else if (rtspSample.type === audioSection?.codec) {
                            if (firstAudioPacket) {
                                firstAudioPacket = false;
                                rtpTracks.audio.firstPacket?.(rtspSample.packet);
                            }
                            audio.onRtp(rtspSample.packet);
                        }
                        else {
                            console.warn('unexpected rtsp sample', rtspSample.type);
                        }
                    }
                }
            });
        }

        safePrintFFmpegArguments(console, args);

        cp = child_process.spawn(ffmpegPath, args, {
            stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
        });
        killDeferred.promise.finally(() => safeKillFFmpeg(cp));
        cp.on('exit', () => {
            if (!allowAudioTranscoderExit)
                killDeferred.resolve(undefined);
        });
        if (pipeSdp) {
            const pipe = cp.stdio[3] as Writable;
            pipe.write(pipeSdp);
            pipe.end();
        }
        ffmpegLogInitialOutput(console, cp);

        if (useRtp) {
            cp.stdio[4].on('data', data => {
                const transcodeSdp = data.toString();
                reportTranscodedSections(transcodeSdp);
            });
        }
    }
    else {
        console.log('bypassing ffmpeg, perfect codecs');
        sdpDeferred.resolve(rtspSdp);
    }

    if (!rtspClientHooked) {
        process.nextTick(() => {
            rtspClient?.readLoop().catch(() => { }).finally(() => killDeferred.resolve(undefined));
        });
    }

    return {
        cp,
        rtspServer: rtspServerDeferred.promise,
        sdpContents: sdpDeferred.promise,
        videoSection: videoSectionDeferred.promise,
        audioSection: audioSectionDeferred.promise,
        kill: () => killDeferred.resolve(undefined),
        killPromise: killDeferred.promise,
        get killed() {
            return killDeferred.finished;
        },
    }
}
