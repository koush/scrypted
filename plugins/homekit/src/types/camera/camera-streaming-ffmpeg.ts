import { RtpPacket } from '@koush/werift-src/packages/rtp/src/rtp/rtp';
import { getDebugModeH264EncoderArgs } from '@scrypted/common/src/ffmpeg-hardware-acceleration';
import { addVideoFilterArguments } from '@scrypted/common/src/ffmpeg-helpers';
import { createBindZero } from '@scrypted/common/src/listen-cluster';
import { getSpsPps } from '@scrypted/common/src/sdp-utils';
import { FFmpegInput, MediaStreamDestination, ScryptedDevice, VideoCamera } from '@scrypted/sdk';
import { RtpTrack, RtpTracks, startRtpForwarderProcess } from '../../../../webrtc/src/rtp-forwarders';
import { AudioStreamingCodecType, SRTPCryptoSuites } from '../../hap';
import { getDebugMode } from './camera-debug-mode-storage';
import { CameraStreamingSession, waitForFirstVideoRtcp } from './camera-streaming-session';
import { createCameraStreamSender } from './camera-streaming-srtp-sender';
import { checkCompatibleCodec, transcodingDebugModeWarning } from './camera-utils';

export async function startCameraStreamFfmpeg(device: ScryptedDevice & VideoCamera, console: Console, storage: Storage, ffmpegInput: FFmpegInput, session: CameraStreamingSession) {
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
    const audiomtu = 400;

    const videoKey = Buffer.concat([session.prepareRequest.video.srtp_key, session.prepareRequest.video.srtp_salt]);
    const audioKey = Buffer.concat([session.prepareRequest.audio.srtp_key, session.prepareRequest.audio.srtp_salt]);

    const mso = ffmpegInput.mediaStreamOptions;
    const videoArgs: string[] = [];
    const audioArgs: string[] = [];

    const debugMode = getDebugMode(storage);
    if (debugMode.audio || debugMode.video)
        transcodingDebugModeWarning();

    const videoCodec = ffmpegInput.mediaStreamOptions?.video?.codec;
    const needsFFmpeg = debugMode.video
        || ffmpegInput.container !== 'rtsp';

    if (ffmpegInput.mediaStreamOptions?.oobCodecParameters)
        videoArgs.push("-bsf:v", "dump_extra");

    // encoder args
    if (debugMode.video) {
        if (debugMode.video) {
            videoArgs.push(...getDebugModeH264EncoderArgs());
        }
        const videoRecordingFilter = `scale=w='min(${request.video.width},iw)':h=-2`;
        addVideoFilterArguments(videoArgs, videoRecordingFilter);

        const bitrate = request.video.max_bit_rate * 1000;
        videoArgs.push(
            "-b:v", bitrate.toString(),
            "-bufsize", (2 * bitrate).toString(),
            "-maxrate", bitrate.toString(),
            '-g', `${4 * request.video.fps}`,
            "-r", request.video.fps.toString(),
        );
    }
    else {
        checkCompatibleCodec(console, device, videoCodec)

        videoArgs.push(
            "-vcodec", "copy",
        );
    }

    // this test path is to force forwarding of packets through the correct port expected by HAP
    // or alternatively used to inspect ffmpeg packets to compare vs what scrypted sends.
    let videoAddress = session.prepareRequest.targetAddress;
    let videoRtpPort = session.prepareRequest.video.port;
    let videoRtcpPort = videoRtpPort;
    if (false) {
        const useRtpSender = true;
        const videoForwarder = await createBindZero();
        videoRtpPort = videoForwarder.port;
        videoRtcpPort = videoRtpPort;
        videoAddress = '127.0.0.1';
        videoForwarder.server.once('message', () => console.log('first forwarded h264 packet received.'));
        session.videoReturn.on('close', () => videoForwarder.server.close());
        if (useRtpSender) {
            const videoSender = createCameraStreamSender(console, session.vconfig, session.videoReturn,
                session.videossrc, session.startRequest.video.pt,
                session.prepareRequest.video.port, session.prepareRequest.targetAddress,
                session.startRequest.video.rtcp_interval,
                {
                    maxPacketSize: session.startRequest.video.mtu,
                    sps: undefined,
                    pps: undefined,
                }
            );
            videoSender.sendRtcp();
            videoForwarder.server.on('message', data => {
                const rtp = RtpPacket.deSerialize(data);
                if (rtp.header.payloadType !== session.startRequest.video.pt)
                    return;
                videoSender.sendRtp(rtp);
            });
        }
        else {
            videoForwarder.server.on('message', data => {
                session.videoReturn.send(data, session.prepareRequest.video.port, session.prepareRequest.targetAddress);
            });
        }
    }

    let rtpSender = storage.getItem('rtpSender') || 'Default';
    console.log({
        tool: mso?.tool,
        rtpSender,
    });
    const h264Info = ffmpegInput.mediaStreamOptions?.video?.h264Info || {};
    const oddity = h264Info.fuab || h264Info.stapb || h264Info.mtap16 || h264Info.mtap32 || h264Info.sei;
    if (rtpSender === 'Default' && oddity) {
        if (mso?.tool === 'scrypted') {
            console.warn('H264 oddities are reported in the stream. Stream tool is marked safe as "scrypted", ignoring oddity. If there are issues streaming, consider switching to FFmpeg Sender.');
        }
        else {
            console.warn('H264 oddities are reported in the stream. Using FFmpeg.');
            rtpSender = 'FFmpeg';
        }
    }

    if (rtpSender === 'Default')
        rtpSender = 'Scrypted';

    if (rtpSender === 'Scrypted' && needsFFmpeg) {
        console.warn('Scrypted RTP Sender can not be used since transcoding is enabled or the stream container is not RTSP.');
    }

    const videoIsSrtpSenderCompatible = !needsFFmpeg && rtpSender === 'Scrypted';
    const audioCodec = request.audio.codec;
    const requestedOpus = audioCodec === AudioStreamingCodecType.OPUS;

    let audio: RtpTrack;
    // homekit live streaming is extremely picky about audio audio packet time.
    // not sending packets of the correct duration will result in mute or choppy audio.
    // the packet time parameter is different between LAN and LTE.
    let opusFramesPerPacket = request.audio.packet_time / 20;

    const noAudio = mso?.audio === null;
    if (noAudio) {
        // no op...
    }
    else if (audioCodec === AudioStreamingCodecType.OPUS || audioCodec === AudioStreamingCodecType.AAC_ELD) {
        // by default opus encodes with a packet time of 20. however, homekit may request another value,
        // which we will respect by simply outputing frames of that duration, rather than packing
        // 20 ms frames to accomodate.
        // the opus repacketizer will pass through those N frame packets as is.

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
        );

        type OnRtp = RtpTrack['onRtp'];
        let onRtp: OnRtp;
        let firstPacket: OnRtp;
        let audioRtcpPort: number;
        let ffmpegDestination: string;

        if (requestedOpus) {
            // opus requires timestamp mangling.
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

            firstPacket = function () {
                audioSender.sendRtcp();
            };

            onRtp = function (rtp) {
                audioSender.sendRtp(RtpPacket.deSerialize(rtp));
            };
        }
        else {
            // can send aac-eld directly.
            ffmpegDestination = `${session.prepareRequest.targetAddress}:${session.prepareRequest.audio.port}`;
        }

        audio = {
            codecCopy: !debugMode.audio && requestedOpus ? 'opus' : 'transcode',
            encoderArguments: audioArgs,
            ffmpegDestination,
            packetSize: audiomtu,
            rtcpPort: audioRtcpPort,
            payloadType: request.audio.pt,
            ssrc: session.audiossrc,
            srtp: !ffmpegDestination ? undefined : {
                crytoSuite: session.prepareRequest.audio.srtpCryptoSuite === SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80 ?
                    "AES_CM_128_HMAC_SHA1_80" : "AES_CM_256_HMAC_SHA1_80",
                key: audioKey,
            },
            firstPacket,
            onRtp,
        }
    }
    else {
        console.warn(device.name, 'homekit requested unknown audio codec, audio will not be streamed.', request);
    }

    // 11/15/2022
    // legacy comment below left for posterity during the transition to rtp-forwarders.ts
    // code.

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

    await waitForFirstVideoRtcp(console, session);

    if (session.killed) {
        console.log('session ended before streaming could start. bailing.');
        return;
    }

    const videoOptions = {
        maxPacketSize: videomtu,
        sps: undefined,
        pps: undefined,
    };

    const videoSender = createCameraStreamSender(console, session.vconfig, session.videoReturn,
        session.videossrc, session.startRequest.video.pt,
        session.prepareRequest.video.port, session.prepareRequest.targetAddress,
        session.startRequest.video.rtcp_interval,
        videoOptions,
    );

    const rtpTracks: RtpTracks = {
        video: {
            codecCopy: videoIsSrtpSenderCompatible ? 'h264' : 'transcode',
            encoderArguments: videoArgs,
            ffmpegDestination: `${videoAddress}:${videoRtpPort}`,
            packetSize: videomtu,
            rtcpPort: videoRtcpPort,
            payloadType: request.video.pt,
            ssrc: session.videossrc,
            srtp: {
                crytoSuite: session.prepareRequest.video.srtpCryptoSuite === SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80 ?
                    "AES_CM_128_HMAC_SHA1_80" : "AES_CM_256_HMAC_SHA1_80",
                key: videoKey,
            },
            onMSection: (videoSection) => {
                const spsPps = getSpsPps(videoSection);
                videoOptions.sps = spsPps?.sps;
                videoOptions.pps = spsPps?.pps;
            },
            firstPacket() {
                videoSender.sendRtcp();
            },
            onRtp(rtp) {
                videoSender.sendRtp(RtpPacket.deSerialize(rtp));
            },
        },
    }
    if (audio)
        rtpTracks.audio = audio;

    const process = await startRtpForwarderProcess(console, ffmpegInput, rtpTracks);

    session.killPromise.finally(() => process.kill());
    process.killPromise.finally(() => session.kill());
}
