import { getDebugModeH264EncoderArgs } from '@scrypted/common/src/ffmpeg-hardware-acceleration';
import { createBindZero } from '@scrypted/common/src/listen-cluster';
import { ffmpegLogInitialOutput, safeKillFFmpeg, safePrintFFmpegArguments } from '@scrypted/common/src/media-helpers';
import { addTrackControls, parseSdp, replacePorts } from '@scrypted/common/src/sdp-utils';
import sdk, { FFmpegInput, MediaStreamDestination, ScryptedDevice, VideoCamera } from '@scrypted/sdk';
import child_process from 'child_process';
import { Writable } from 'stream';
import { RtpPacket } from '@koush/werift/packages/rtp/src/rtp/rtp';
import { AudioStreamingCodecType, SRTPCryptoSuites } from '../../hap';
import { CameraStreamingSession, waitForFirstVideoRtcp } from './camera-streaming-session';
import { startCameraStreamSrtp } from './camera-streaming-srtp';
import { createCameraStreamSender } from './camera-streaming-srtp-sender';
import { checkCompatibleCodec, transcodingDebugModeWarning } from './camera-utils';

const { mediaManager, log } = sdk;

export async function startCameraStreamFfmpeg(device: ScryptedDevice & VideoCamera, console: Console, storage: Storage, destination: MediaStreamDestination, ffmpegInput: FFmpegInput, session: CameraStreamingSession) {
    const request = session.startRequest;

    const videomtu = session.startRequest.video.mtu;
    // 400 seems fine? no idea what to use here. this is the mtu for sending audio to homekit.
    // from my observation of talkback packets, the max packet size is ~370, so
    // I'm just guessing that HomeKit wants something similar for the audio it receives.
    // going higher causes choppiness. going lower may cause other issues.
    // Update: since implementing Opus, I'm unsure this value actually has any affect
    // unless ffmpeg is buffering packets. Opus supports a packet time argument,
    // which in turn limits the packet size. I'm not sure if AAC-ELD has a similar
    // option, but not sure it matters since AAC-ELD is no longer in use.
    let audiomtu = 400;

    // test code path that allows using two ffmpeg processes. did not see
    // any notable benefit with a prebuffer, which allows the ffmpeg analysis for key frame
    // to immediately finish. ffmpeg will only start sending on a key frame.
    // const audioInput = JSON.parse((await mediaManager.convertMediaObjectToBuffer(await device.getVideoStream(selectedStream), ScryptedMimeTypes.FFmpegInput)).toString()) as FFmpegInput;
    let audioInput = ffmpegInput;

    const videoKey = Buffer.concat([session.prepareRequest.video.srtp_key, session.prepareRequest.video.srtp_salt]);
    const audioKey = Buffer.concat([session.prepareRequest.audio.srtp_key, session.prepareRequest.audio.srtp_salt]);

    const mso = ffmpegInput.mediaStreamOptions;
    const noAudio = mso?.audio === null;
    const hideBanner = [
        '-hide_banner',
    ];
    const videoArgs: string[] = [];
    const audioArgs: string[] = [];

    const nullAudioInput: string[] = [];
    if (!noAudio) {
        // create a dummy audio track if none actually exists.
        // this track will only be used if no audio track is available.
        // this prevents homekit erroring out if the audio track is actually missing.
        // https://stackoverflow.com/questions/37862432/ffmpeg-output-silent-audio-track-if-source-has-no-audio-or-audio-is-shorter-th
        nullAudioInput.push('-f', 'lavfi', '-i', 'anullsrc=cl=1', '-shortest');
    }

    const transcodingDebugMode = storage.getItem('transcodingDebugMode') === 'true';
    if (transcodingDebugMode)
        transcodingDebugModeWarning();

    const videoCodec = ffmpegInput.mediaStreamOptions?.video?.codec;
    const needsFFmpeg = transcodingDebugMode
        || !!ffmpegInput.h264EncoderArguments?.length
        || !!ffmpegInput.h264FilterArguments?.length
        || ffmpegInput.container !== 'rtsp';

    videoArgs.push(
        "-an", '-sn', '-dn',
    );

    // encoder args
    if (transcodingDebugMode) {
        const videoCodec =
            [
                "-b:v", request.video.max_bit_rate.toString() + "k",
                "-bufsize", (2 * request.video.max_bit_rate).toString() + "k",
                "-maxrate", request.video.max_bit_rate.toString() + "k",
                "-r", request.video.fps.toString(),

                ...getDebugModeH264EncoderArgs(),
            ];

        videoArgs.push(
            ...videoCodec,
        )
    }
    else if (ffmpegInput.h264EncoderArguments?.length) {
        const bitrate = ffmpegInput.destinationVideoBitrate || (request.video.max_bit_rate * 1000);
        const videoCodec: string[] =
            [
                "-b:v", bitrate.toString(),
                "-bufsize", (2 * bitrate).toString(),
                "-maxrate", bitrate.toString(),
                "-r", request.video.fps.toString(),

                ...ffmpegInput.h264EncoderArguments,
            ];

        videoArgs.push(
            ...videoCodec,
        )
    }
    else {
        checkCompatibleCodec(console, device, videoCodec)

        videoArgs.push(
            "-vcodec", "copy",
        );
    }

    if (ffmpegInput.h264FilterArguments?.length) {
        videoArgs.push(...ffmpegInput.h264FilterArguments);
    }

    let videoOutput = `srtp://${session.prepareRequest.targetAddress}:${session.prepareRequest.video.port}?rtcpport=${session.prepareRequest.video.port}&pkt_size=${videomtu}`;
    let useSrtp = true;

    // this test path is to force forwarding of packets through the correct port expected by HAP
    // or alternatively used to inspect ffmpeg packets to compare vs what scrypted sends.
    if (false) {
        const useRtpSender = true;
        const videoForwarder = await createBindZero();
        videoForwarder.server.once('message', () => console.log('first forwarded h264 packet received.'));
        session.videoReturn.on('close', () => videoForwarder.server.close());
        if (useRtpSender) {
            useSrtp = false;
            const videoSender = createCameraStreamSender(console, session.vconfig, session.videoReturn,
                session.videossrc, session.startRequest.video.pt,
                session.prepareRequest.video.port, session.prepareRequest.targetAddress,
                session.startRequest.video.rtcp_interval, {
                    maxPacketSize: session.startRequest.video.mtu,
                    sps: undefined,
                    pps: undefined,
                }
            );
            videoForwarder.server.on('message', data => {
                const rtp = RtpPacket.deSerialize(data);
                if (rtp.header.payloadType !== session.startRequest.video.pt)
                    return;
                videoSender(rtp);
            });
            videoOutput = `rtp://127.0.0.1:${videoForwarder.port}?rtcpport=${videoForwarder.port}&pkt_size=${videomtu}`;
        }
        else {
            videoForwarder.server.on('message', data => {
                session.videoReturn.send(data, session.prepareRequest.video.port, session.prepareRequest.targetAddress);
            });
            videoOutput = `srtp://127.0.0.1:${videoForwarder.port}?rtcpport=${videoForwarder.port}&pkt_size=${videomtu}`;
        }
    }

    if (useSrtp) {
        videoArgs.push(
            "-srtp_out_suite", session.prepareRequest.video.srtpCryptoSuite === SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80 ?
            "AES_CM_128_HMAC_SHA1_80" : "AES_CM_256_HMAC_SHA1_80",
            "-srtp_out_params", videoKey.toString('base64'),
        );
    }

    videoArgs.push(
        "-payload_type", request.video.pt.toString(),
        "-ssrc", session.videossrc.toString(),
        "-f", "rtp",
        videoOutput,
    );

    let rtpSender = storage.getItem('rtpSender') || 'Default';
    console.log({
        tool: mso?.tool,
        rtpSender,
    });
    if (rtpSender === 'Default')
        rtpSender = 'Scrypted';

    if (rtpSender === 'Scrypted' && needsFFmpeg) {
        console.warn('Scrypted RTP Sender can not be used since transcoding is enabled or the stream container is not RTSP.');
    }

    const videoIsSrtpSenderCompatible = !needsFFmpeg && rtpSender === 'Scrypted';
    const audioCodec = request.audio.codec;
    const requestedOpus = audioCodec === AudioStreamingCodecType.OPUS;

    if (noAudio) {
        if (videoIsSrtpSenderCompatible) {
            console.log('camera has perfect codecs (no audio), using srtp only fast path.');
            await startCameraStreamSrtp(ffmpegInput, console, { mute: true }, session);
            return;
        }
    }
    else {
        // audio encoding
        audioArgs.push(
            "-vn", '-sn', '-dn',
        );

        // homekit live streaming is extremely picky about audio audio packet time.
        // not sending packets of the correct duration will result in mute or choppy audio.
        // the packet time parameter is different between LAN and LTE.
        let opusFramesPerPacket = request.audio.packet_time / 20;

        const perfectOpus = requestedOpus
            && mso?.audio?.codec === 'opus'
            // sanity check this
            && opusFramesPerPacket && opusFramesPerPacket === Math.round(opusFramesPerPacket);

        if (videoIsSrtpSenderCompatible && perfectOpus) {
            console.log('camera has perfect codecs, using srtp only fast path.');
            await startCameraStreamSrtp(ffmpegInput, console, { mute: false }, session);
            return;
        }
        else if (audioCodec === AudioStreamingCodecType.OPUS || audioCodec === AudioStreamingCodecType.AAC_ELD) {
            if (!transcodingDebugMode && perfectOpus) {
                audioArgs.push(
                    "-acodec", "copy",
                );
            }
            else {
                // by default opus encodes with a packet time of 20. however, homekit may request another value,
                // which we will respect by simply outputing frames of that duration, rather than packing
                // 20 ms frames to accomodate.
                opusFramesPerPacket = 1;

                audioArgs.push(
                    '-acodec', ...(requestedOpus ?
                        [
                            'libopus',
                            '-application', 'lowdelay',
                            '-frame_duration', request.audio.packet_time.toString(),
                        ] :
                        ['libfdk_aac', '-profile:a', 'aac_eld']),
                    '-flags', '+global_header',
                    '-ar', `${request.audio.sample_rate}k`,
                    '-b:a', `${request.audio.max_bit_rate}k`,
                    "-bufsize", `${request.audio.max_bit_rate * 4}k`,
                    '-ac', `${request.audio.channel}`,
                )
            }
            audioArgs.push(
                "-payload_type", request.audio.pt.toString(),
                "-ssrc", session.audiossrc.toString(),
                "-f", "rtp",
            );

            if (requestedOpus) {
                // opus requires timestamp mangling.
                const audioForwarder = await createBindZero();
                audioForwarder.server.once('message', () => console.log('first forwarded opus packet received.'));
                session.audioReturn.on('close', () => audioForwarder.server.close());

                const audioSender = createCameraStreamSender(console, session.aconfig, session.audioReturn,
                    session.audiossrc, session.startRequest.audio.pt,
                    session.prepareRequest.audio.port, session.prepareRequest.targetAddress,
                    session.startRequest.audio.rtcp_interval, undefined,
                    {
                        audioPacketTime: session.startRequest.audio.packet_time,
                        audioSampleRate: session.startRequest.audio.sample_rate,
                        framesPerPacket: opusFramesPerPacket,
                    }
                );
                audioForwarder.server.on('message', data => {
                    const packet = RtpPacket.deSerialize(data);
                    audioSender(packet);
                });
                audioArgs.push(
                    `rtp://127.0.0.1:${audioForwarder.port}?rtcpport=${session.prepareRequest.audio.port}&pkt_size=${audiomtu}`
                )
            }
            else {
                audioArgs.push(
                    "-srtp_out_suite",
                    session.prepareRequest.audio.srtpCryptoSuite === SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80
                        ? "AES_CM_128_HMAC_SHA1_80"
                        : "AES_CM_256_HMAC_SHA1_80",
                    "-srtp_out_params", audioKey.toString('base64'),
                    `srtp://${session.prepareRequest.targetAddress}:${session.prepareRequest.audio.port}?rtcpport=${session.prepareRequest.audio.port}&pkt_size=${audiomtu}`
                )
            }
        }
        else {
            console.warn(device.name, 'homekit requested unknown audio codec, audio will not be streamed.', request);

            if (videoIsSrtpSenderCompatible) {
                console.log('camera has perfect codecs (unknown audio), using srtp only fast path.');
                await startCameraStreamSrtp(ffmpegInput, console, { mute: true }, session);
                return;
            }
        }
    }

    const ffmpegPath = await mediaManager.getFFmpegPath();

    if (session.killed) {
        console.log('session ended before streaming could start. bailing.');
        return;
    }

    const videoDecoderArguments = ffmpegInput.videoDecoderArguments || [];

    // From my naive observations, ffmpeg seems to drop the first few packets if it is
    // performing encoder/decoder initialization. Thiss is particularly problematic if
    // the stream starts on a key frame, meaning it will wait an entire IDR interval
    // before rendering.
    // Two theories:
    // The first is that the SPS/PPS initializes the decoder/parser, and during that init,
    // it will drop all incoming packets on the floor until it is ready.
    // The other theory is that audio decoder initialization may cause dropped video packets
    // while the pipeline spins up.
    // By demuxing the audio and video into separate srtp sender and ffmpeg forwarder,
    // the video is allowed to start up immediately.
    // This should only be used when opus is requested, because then both streams will be sent
    // via the srtp sender (opus will be forwarded repacketized after transcoding).
    // It is unclear if this will work reliably with ffmpeg/aac-eld which uses it's own
    // ntp timestamp algorithm. aac-eld is deprecated in any case.
    if (videoIsSrtpSenderCompatible && requestedOpus) {
        console.log('camera has perfect codecs (demuxed audio), using srtp fast path.');

        const udpPort = Math.floor(Math.random() * 10000 + 30000);

        const fullSdp = await startCameraStreamSrtp(ffmpegInput, console, { mute: false, udpPort }, session);

        const audioSdp = parseSdp(fullSdp);
        const audioSection = audioSdp.msections.find(msection => msection.type === 'audio');
        if (audioSection) {
            const ffmpegAudioTranscodeArguments = [
                ...hideBanner,
                '-protocol_whitelist', 'pipe,udp,rtp,file,crypto,tcp',
                '-f', 'sdp', '-i', 'pipe:3',
                ...nullAudioInput,
                ...audioArgs,
            ];
            safePrintFFmpegArguments(console, ffmpegAudioTranscodeArguments);
            const ap = child_process.spawn(ffmpegPath, ffmpegAudioTranscodeArguments, {
                stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
            });
            session.killPromise.finally(() => safeKillFFmpeg(ap));

            ffmpegLogInitialOutput(console, ap);
            ap.on('exit', () => session.kill());
            audioSdp.msections = [audioSection];
            const ffmpegSdp = addTrackControls(replacePorts(audioSdp.toSdp(), udpPort, 0));
            console.log('demuxed audio sdp', ffmpegSdp);

            const pipe = ap.stdio[3] as Writable;
            pipe.write(ffmpegSdp);
            pipe.end();
        }
        else {
            console.warn('sdp is missing audio. audio will be muted.');
        }

        return;
    }

    await waitForFirstVideoRtcp(console, session);

    if (audioInput !== ffmpegInput) {
        safePrintFFmpegArguments(console, videoArgs);
        safePrintFFmpegArguments(console, audioArgs);

        const vp = child_process.spawn(ffmpegPath, [
            ...hideBanner,
            ...videoDecoderArguments,
            ...ffmpegInput.inputArguments,
            ...videoArgs,
        ]);
        session.killPromise.finally(() => safeKillFFmpeg(vp));
        ffmpegLogInitialOutput(console, vp);
        vp.on('exit', () => session.kill());

        const ap = child_process.spawn(ffmpegPath, [
            ...hideBanner,
            ...audioInput.inputArguments,
            ...nullAudioInput,
            ...audioArgs,
        ]);
        session.killPromise.finally(() => safeKillFFmpeg(ap));
        ffmpegLogInitialOutput(console, ap);
        ap.on('exit', () => session.kill());
    }
    else {
        const args = [
            ...hideBanner,
            ...videoDecoderArguments,
            ...ffmpegInput.inputArguments,
            ...nullAudioInput,
            ...videoArgs,
            ...audioArgs,
        ];
        safePrintFFmpegArguments(console, args);

        const cp = child_process.spawn(ffmpegPath, args);
        session.killPromise.finally(() => safeKillFFmpeg(cp));
        ffmpegLogInitialOutput(console, cp);
        cp.on('exit', () => session.kill());
    }
}
