import { createBindZero } from '@scrypted/common/src/listen-cluster';
import { ffmpegLogInitialOutput, safePrintFFmpegArguments } from '@scrypted/common/src/media-helpers';
import sdk, { FFMpegInput, MediaStreamOptions, ScryptedDevice, ScryptedMimeTypes, VideoCamera } from '@scrypted/sdk';
import child_process from 'child_process';
import { RtpPacket } from '../../../../../external/werift/packages/rtp/src/rtp/rtp';
import { ProtectionProfileAes128CmHmacSha1_80 } from '../../../../../external/werift/packages/rtp/src/srtp/const';
import { AudioStreamingCodecType, SRTPCryptoSuites, StartStreamRequest } from '../../hap';
import { evalRequest } from '../camera/camera-transcode';
import { CameraStreamingSession, KillCameraStreamingSession } from './camera-streaming-session';
import { createCameraStreamSender } from './camera-streaming-srtp-sender';

const { mediaManager } = sdk;

export async function startCameraStreamFfmpeg(device: ScryptedDevice & VideoCamera, console: Console, storage: Storage, selectedStream: MediaStreamOptions, transcodeStreaming: boolean, session: CameraStreamingSession, killSession: KillCameraStreamingSession) {

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

    console.log('fetching video stream');
    const videoInput = JSON.parse((await mediaManager.convertMediaObjectToBuffer(await device.getVideoStream(selectedStream), ScryptedMimeTypes.FFmpegInput)).toString()) as FFMpegInput;
    // test code path that allows using two ffmpeg processes. did not see
    // any notable benefit with a prebuffer, which allows the ffmpeg analysis for key frame
    // to immediately finish. ffmpeg will only start sending on a key frame.
    // const audioInput = JSON.parse((await mediaManager.convertMediaObjectToBuffer(await device.getVideoStream(selectedStream), ScryptedMimeTypes.FFmpegInput)).toString()) as FFMpegInput;
    const audioInput = videoInput;

    const videoKey = Buffer.concat([session.prepareRequest.video.srtp_key, session.prepareRequest.video.srtp_salt]);
    const audioKey = Buffer.concat([session.prepareRequest.audio.srtp_key, session.prepareRequest.audio.srtp_salt]);

    const mso = videoInput.mediaStreamOptions;
    const noAudio = mso?.audio === null;
    const hideBanner = [
        '-hide_banner',
    ];
    const decoderArgs: string[] = [];
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

    // decoder args
    if (transcodeStreaming) {
        // decoder arguments
        const videoDecoderArguments = storage.getItem('videoDecoderArguments') || '';
        if (videoDecoderArguments) {
            decoderArgs.push(...evalRequest(videoDecoderArguments, request));
        }
    }

    videoArgs.push(
        "-an", '-sn', '-dn',
    );

    // encoder args
    if (transcodeStreaming) {
        const h264EncoderArguments = storage.getItem('h264EncoderArguments') || '';
        const videoCodec = h264EncoderArguments
            ? evalRequest(h264EncoderArguments, request) :
            [
                "-vcodec", "libx264",
                // '-preset', 'ultrafast', '-tune', 'zerolatency',
                '-pix_fmt', 'yuvj420p',
                // '-color_range', 'mpeg',
                "-bf", "0",
                // "-profile:v", profileToFfmpeg(request.video.profile),
                // '-level:v', levelToFfmpeg(request.video.level),
                "-b:v", request.video.max_bit_rate.toString() + "k",
                "-bufsize", (2 * request.video.max_bit_rate).toString() + "k",
                "-maxrate", request.video.max_bit_rate.toString() + "k",
                "-filter:v", "fps=" + request.video.fps.toString(),
            ];

        videoArgs.push(
            ...videoCodec,
        )
    }
    else {
        videoArgs.push(
            "-vcodec", "copy",
        );

        // 3/6/2022
        // Ran into an issue where the RTSP source had SPS/PPS in the SDP,
        // and none in the bitstream. Codec copy will not add SPS/PPS before IDR frames
        // unless this flag is used.
        // 3/7/2022
        // This flag was enabled by default, but I believe this is causing issues with some users.
        // Make it a setting.
        if (storage.getItem('needsExtraData') === 'true')
            videoArgs.push("-bsf:v", "dump_extra");
    }

    let videoOutput = `srtp://${session.prepareRequest.targetAddress}:${session.prepareRequest.video.port}?rtcpport=${session.prepareRequest.video.port}&pkt_size=${videomtu}`;

    if (false) {
        // this test code helped me determine ffmpeg behavior when streaming
        // beginning with a non key frame.
        // ffmpeg will only start sending rtp data once an sps/pps/keyframe has been received.
        // when using ffmpeg, it is safe to pipe a prebuffer, even when using cellular
        // or apple watch.
        const videoForwarder = await createBindZero();
        videoForwarder.server.once('message', () => console.log('first opus packet received.'));
        session.videoReturn.on('close', () => videoForwarder.server.close());
        let needSpsPps = true;
        videoForwarder.server.on('message', data => {
            // const packet = RtpPacket.deSerialize(data);
            // rtp header is ~12
            // sps/pps is ~32-40.
            if (needSpsPps) {
                if (data.length > 64) {
                    console.log('not sps/pps');
                    return;
                }
                needSpsPps = false;
                console.log('found sps/pps');
            }
            videoForwarder.server.send(data, session.prepareRequest.video.port, session.prepareRequest.targetAddress);
        });
        videoOutput = `srtp://127.0.0.1:${videoForwarder.port}?rtcpport=${videoForwarder.port}&pkt_size=${videomtu}`;
    }

    videoArgs.push(
        "-payload_type", (request as StartStreamRequest).video.pt.toString(),
        "-ssrc", session.videossrc.toString(),
        // '-fflags', '+flush_packets', '-flush_packets', '1',
        "-f", "rtp",
        "-srtp_out_suite", session.prepareRequest.video.srtpCryptoSuite === SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80 ?
        "AES_CM_128_HMAC_SHA1_80" : "AES_CM_256_HMAC_SHA1_80",
        "-srtp_out_params", videoKey.toString('base64'),
        videoOutput,
    );

    if (!noAudio) {
        // audio encoding
        const audioCodec = (request as StartStreamRequest).audio.codec;
        audioArgs.push(
            "-vn", '-sn', '-dn',
        );

        // homekit live streaming seems extremely picky about audio formats.
        // sending the incorrect packet time or bitrate, etc, can cause streaming
        // to fail altogether. these parameters can also change between LAN and LTE.
        const perfectAac = audioCodec === AudioStreamingCodecType.AAC_ELD
            && mso?.audio?.codec === 'aac'
            && mso?.audio?.encoder === 'scrypted';

        const requestedOpus = audioCodec === AudioStreamingCodecType.OPUS;

        const perfectOpus = requestedOpus
            && mso?.audio?.codec === 'opus'
            && mso?.audio?.encoder === 'scrypted';

        let hasAudio = true;
        if (!transcodeStreaming
            && (perfectAac || perfectOpus)
            && mso?.tool === 'scrypted') {
            audioArgs.push(
                "-acodec", "copy",
            );
        }
        else if (audioCodec === AudioStreamingCodecType.OPUS || audioCodec === AudioStreamingCodecType.AAC_ELD) {
            audioArgs.push(
                '-acodec', ...(requestedOpus ?
                    [
                        'libopus',
                        '-application', 'lowdelay',
                        '-frame_duration', (request as StartStreamRequest).audio.packet_time.toString(),
                    ] :
                    ['libfdk_aac', '-profile:a', 'aac_eld']),
                '-flags', '+global_header',
                '-ar', `${(request as StartStreamRequest).audio.sample_rate}k`,
                '-b:a', `${(request as StartStreamRequest).audio.max_bit_rate}k`,
                "-bufsize", `${(request as StartStreamRequest).audio.max_bit_rate * 4}k`,
                '-ac', `${(request as StartStreamRequest).audio.channel}`,
            )
        }
        else {
            hasAudio = false;
            console.warn(device.name, 'unknown audio codec, audio will not be streamed.', request);
        }
        if (hasAudio) {
            audioArgs.push(
                "-payload_type", (request as StartStreamRequest).audio.pt.toString(),
                "-ssrc", session.audiossrc.toString(),
                "-f", "rtp",
            );

            if (requestedOpus) {
                // opus requires timestamp mangling.
                const aconfig = {
                    keys: {
                        localMasterKey: session.prepareRequest.audio.srtp_key,
                        localMasterSalt: session.prepareRequest.audio.srtp_salt,
                        remoteMasterKey: session.prepareRequest.audio.srtp_key,
                        remoteMasterSalt: session.prepareRequest.audio.srtp_salt,
                    },
                    profile: ProtectionProfileAes128CmHmacSha1_80,
                };

                const audioForwarder = await createBindZero();
                audioForwarder.server.once('message', () => console.log('first opus packet received.'));
                session.audioReturn.on('close', () => audioForwarder.server.close());

                const audioSender = createCameraStreamSender(aconfig, session.audioReturn,
                    session.audiossrc, session.startRequest.audio.pt,
                    session.prepareRequest.audio.port, session.prepareRequest.targetAddress,
                    session.startRequest.audio.rtcp_interval,
                    session.startRequest.audio.packet_time,
                    session.startRequest.audio.sample_rate,
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
                    // not sure this has any effect? testing.
                    // '-fflags', '+flush_packets', '-flush_packets', '1',
                    `srtp://${session.prepareRequest.targetAddress}:${session.prepareRequest.audio.port}?rtcpport=${session.prepareRequest.audio.port}&pkt_size=${audiomtu}`
                )
            }
        }
    }

    const ffmpegPath = await mediaManager.getFFmpegPath();

    if (session.killed) {
        console.log('session ended before streaming could start. bailing.');
        return;
    }

    console.log('ffmpeg', ffmpegPath);

    if (audioInput !== videoInput) {
        safePrintFFmpegArguments(console, videoArgs);
        safePrintFFmpegArguments(console, audioArgs);

        const vp = child_process.spawn(ffmpegPath, [
            ...hideBanner,
            ...decoderArgs,
            ...videoInput.inputArguments,
            ...videoArgs,
        ]);
        session.videoProcess = vp;
        ffmpegLogInitialOutput(console, vp);
        vp.on('exit', killSession);

        const ap = child_process.spawn(ffmpegPath, [
            ...hideBanner,
            ...decoderArgs,
            ...audioInput.inputArguments,
            ...nullAudioInput,
            ...audioArgs,
        ]);
        session.audioProcess = ap;
        ffmpegLogInitialOutput(console, ap);
        ap.on('exit', killSession);
    }
    else {
        const args = [
            ...hideBanner,
            ...decoderArgs,
            ...videoInput.inputArguments,
            ...nullAudioInput,
            ...videoArgs,
            ...audioArgs,
        ];
        safePrintFFmpegArguments(console, args);

        const cp = child_process.spawn(ffmpegPath, args);
        session.videoProcess = cp;
        ffmpegLogInitialOutput(console, cp);
        cp.on('exit', killSession);
    }
}
