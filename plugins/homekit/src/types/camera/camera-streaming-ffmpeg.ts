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

export async function startCameraStreamFfmpeg(device: ScryptedDevice & VideoCamera, console: Console, storage: Storage, selectedStream: MediaStreamOptions, session: CameraStreamingSession, killSession: KillCameraStreamingSession) {

    const { isHomeKitHub } = session;
    const request = session.startRequest;

    const videomtu = session.startRequest.video.mtu;
    // 400 seems fine? no idea what to use here. this is the mtu for sending audio to homekit.
    // from my observation of talkback packets, the max packet size is ~370, so
    // I'm just guessing that HomeKit wants something similar for the audio it receives.
    // going higher causes choppiness. going lower may cause other issues.
    let audiomtu = 400;

    console.log('fetching video stream');
    const media = await device.getVideoStream(selectedStream);
    const ffmpegInput = JSON.parse((await mediaManager.convertMediaObjectToBuffer(media, ScryptedMimeTypes.FFmpegInput)).toString()) as FFMpegInput;

    const videoKey = Buffer.concat([session.prepareRequest.video.srtp_key, session.prepareRequest.video.srtp_salt]);
    const audioKey = Buffer.concat([session.prepareRequest.audio.srtp_key, session.prepareRequest.audio.srtp_salt]);

    const mso = ffmpegInput.mediaStreamOptions;
    const noAudio = mso?.audio === null;
    const args: string[] = [
        '-hide_banner',
    ];

    const transcodeStreaming = isHomeKitHub
        ? storage.getItem('transcodeStreamingHub') === 'true'
        : storage.getItem('transcodeStreaming') === 'true';

    if (transcodeStreaming) {
        // decoder arguments
        const videoDecoderArguments = storage.getItem('videoDecoderArguments') || '';
        if (videoDecoderArguments) {
            args.push(...evalRequest(videoDecoderArguments, request));
        }
    }

    // ffmpeg input for decoder
    args.push(...ffmpegInput.inputArguments);

    if (!noAudio) {
        // create a dummy audio track if none actually exists.
        // this track will only be used if no audio track is available.
        // this prevents homekit erroring out if the audio track is actually missing.
        // https://stackoverflow.com/questions/37862432/ffmpeg-output-silent-audio-track-if-source-has-no-audio-or-audio-is-shorter-th
        args.push('-f', 'lavfi', '-i', 'anullsrc=cl=1', '-shortest');
    }

    // video encoding
    args.push(
        "-an", '-sn', '-dn',
    );

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

        args.push(
            ...videoCodec,
        )
    }
    else {
        args.push(
            "-vcodec", "copy",
            "-bsf:v", "dump_extra",
        );
    }

    args.push(
        "-payload_type", (request as StartStreamRequest).video.pt.toString(),
        "-ssrc", session.videossrc.toString(),
        "-f", "rtp",
        "-srtp_out_suite", session.prepareRequest.video.srtpCryptoSuite === SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80 ?
        "AES_CM_128_HMAC_SHA1_80" : "AES_CM_256_HMAC_SHA1_80",
        "-srtp_out_params", videoKey.toString('base64'),
        `srtp://${session.prepareRequest.targetAddress}:${session.prepareRequest.video.port}?rtcpport=${session.prepareRequest.video.port}&pkt_size=${videomtu}`
    )

    if (!noAudio) {
        // audio encoding
        const audioCodec = (request as StartStreamRequest).audio.codec;
        args.push(
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
            args.push(
                "-acodec", "copy",
            );
        }
        else if (audioCodec === AudioStreamingCodecType.OPUS || audioCodec === AudioStreamingCodecType.AAC_ELD) {
            args.push(
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
            args.push(
                "-payload_type", (request as StartStreamRequest).audio.pt.toString(),
                "-ssrc", session.audiossrc.toString(),
                "-srtp_out_suite", session.prepareRequest.audio.srtpCryptoSuite === SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80 ?
                "AES_CM_128_HMAC_SHA1_80" : "AES_CM_256_HMAC_SHA1_80",
                "-srtp_out_params", audioKey.toString('base64'),
                // not sure this has any effect? testing.
                // '-fflags', '+flush_packets', '-flush_packets', '1',
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

                const mangler = await createBindZero();

                const sender = createCameraStreamSender(aconfig, mangler.server,
                    session.audiossrc, session.startRequest.audio.pt,
                    session.prepareRequest.audio.port, session.prepareRequest.targetAddress,
                    session.startRequest.audio.rtcp_interval,
                    session.startRequest.audio.packet_time,
                    session.startRequest.audio.sample_rate,
                );
                session.opusMangler = mangler.server;
                mangler.server.on('message', data => {
                    const packet = RtpPacket.deSerialize(data);
                    sender(packet);
                });
                args.push(
                    `rtp://127.0.0.1:${mangler.port}?rtcpport=${session.prepareRequest.audio.port}&pkt_size=${audiomtu}`
                )
            }
            else {
                args.push(
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

    safePrintFFmpegArguments(console, args);

    console.log('ffmpeg', ffmpegPath);
    const cp = child_process.spawn(ffmpegPath, args);
    ffmpegLogInitialOutput(console, cp);

    session.cp = cp;
    cp.on('exit', killSession);
}
