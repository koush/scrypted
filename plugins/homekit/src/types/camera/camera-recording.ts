
import { FFMpegInput, MotionSensor, ScryptedDevice, ScryptedMimeTypes, VideoCamera, AudioSensor, MediaStreamOptions } from '@scrypted/sdk'
import net from 'net';

import sdk from '@scrypted/sdk';

import { AudioRecordingCodecType, AudioRecordingSamplerateValues, CameraRecordingConfiguration } from '../../hap';
import { FFMpegFragmentedMP4Session, startFFMPegFragmetedMP4Session } from '@scrypted/common/src/ffmpeg-mp4-parser-session';
import { evalRequest } from './camera-transcode';
import { parseFragmentedMP4 } from '@scrypted/common/src/stream-parser';
import { Duplex } from 'stream';

const { log, mediaManager, deviceManager } = sdk;


export const iframeIntervalSeconds = 4;

export async function* handleFragmentsRequests(device: ScryptedDevice & VideoCamera & MotionSensor & AudioSensor,
    configuration: CameraRecordingConfiguration, console: Console): AsyncGenerator<Buffer, void, unknown> {

    console.log(device.name, 'recording session starting', configuration);

    const storage = deviceManager.getMixinStorage(device.id, undefined);

    let selectedStream: MediaStreamOptions;
    let recordingChannel = storage.getItem('recordingChannel');
    if (recordingChannel) {
        const msos = await device.getVideoStreamOptions();
        selectedStream = msos.find(mso => mso.name === recordingChannel);
    }

    const media = await device.getVideoStream({
        id: selectedStream?.id,
        prebuffer: configuration.mediaContainerConfiguration.prebufferLength,
        container: 'mp4',
    });
    const ffmpegInput = JSON.parse((await mediaManager.convertMediaObjectToBuffer(media, ScryptedMimeTypes.FFmpegInput)).toString()) as FFMpegInput;
    if (!ffmpegInput.mediaStreamOptions?.prebuffer) {
        log.a(`${device.name} is not prebuffered. Please install and enable the Rebroadcast plugin.`);
    }

    const noAudio = ffmpegInput.mediaStreamOptions && ffmpegInput.mediaStreamOptions.audio === null;
    const audioCodec = ffmpegInput.mediaStreamOptions?.audio?.codec;
    const isDefinitelyNotAAC = !audioCodec || audioCodec.toLowerCase().indexOf('aac') === -1;
    const transcodeRecording = storage.getItem('transcodeRecording') === 'true';
    const incompatibleStream = noAudio || transcodeRecording || isDefinitelyNotAAC;

    let session: FFMpegFragmentedMP4Session & { socket?: Duplex };

    if (ffmpegInput.container === 'mp4' && ffmpegInput.url.startsWith('tcp://') && !incompatibleStream) {
        console.log('prebuffer is tcp/mp4/h264/aac compatible. using direct tcp.');
        const socketUrl = new URL(ffmpegInput.url);
        const socket = net.connect(parseInt(socketUrl.port), socketUrl.hostname);
        session = {
            socket,
            cp: undefined,
            generator: parseFragmentedMP4(socket),
        }
    }
    else {
        const inputArguments: string[] = [];
        const request: any = {
            video: {
                width: configuration.videoCodec.resolution[0],
                height: configuration.videoCodec.resolution[1],
                fps: configuration.videoCodec.resolution[2],
                max_bit_rate: configuration.videoCodec.bitrate,
            }
        }

        if (transcodeRecording) {
            // decoder arguments
            const videoDecoderArguments = storage.getItem('videoDecoderArguments') || '';
            if (videoDecoderArguments) {
                inputArguments.push(...evalRequest(videoDecoderArguments, request));
            }
        }

        inputArguments.push(...ffmpegInput.inputArguments)


        if (noAudio) {
            console.log(device.name, 'adding dummy audio track');
            // create a dummy audio track if none actually exists.
            // this track will only be used if no audio track is available.
            // https://stackoverflow.com/questions/37862432/ffmpeg-output-silent-audio-track-if-source-has-no-audio-or-audio-is-shorter-th
            inputArguments.push('-f', 'lavfi', '-i', 'anullsrc=cl=1', '-shortest');
        }

        let audioArgs: string[];
        if (noAudio || transcodeRecording || isDefinitelyNotAAC) {
            if (!(noAudio || transcodeRecording))
                console.warn('Recording audio is not explicitly AAC, forcing transcoding. Setting audio output to AAC is recommended.', audioCodec);
            audioArgs = [
                ...(configuration.audioCodec.type === AudioRecordingCodecType.AAC_LC ?
                    ['-acodec', 'aac', '-profile:a', 'aac_low'] :
                    ['-acodec', 'libfdk_aac', '-profile:a', 'aac_eld']),
                '-ar', `${AudioRecordingSamplerateValues[configuration.audioCodec.samplerate]}k`,
                '-b:a', `${configuration.audioCodec.bitrate}k`,
                '-ac', `${configuration.audioCodec.audioChannels}`
            ];
        }
        else {
            audioArgs = [
                '-acodec', 'copy',
                '-bsf:a', 'aac_adtstoasc',
            ];
        }

        let videoArgs: string[];
        if (transcodeRecording) {
            const h264EncoderArguments = storage.getItem('h264EncoderArguments') || '';
            videoArgs = h264EncoderArguments
                ? evalRequest(h264EncoderArguments, request) : [
                    "-vcodec", "libx264",
                    // '-preset', 'ultrafast', '-tune', 'zerolatency',
                    '-pix_fmt', 'yuvj420p',
                    // '-color_range', 'mpeg',
                    "-bf", "0",
                    // "-profile:v", profileToFfmpeg(request.video.profile),
                    // '-level:v', levelToFfmpeg(request.video.level),
                    '-b:v', `${configuration.videoCodec.bitrate}k`,
                    "-bufsize", (2 * request.video.max_bit_rate).toString() + "k",
                    "-maxrate", request.video.max_bit_rate.toString() + "k",
                    "-filter:v", `fps=${request.video.fps},scale=w=${configuration.videoCodec.resolution[0]}:h=${configuration.videoCodec.resolution[1]}:force_original_aspect_ratio=1,pad=${configuration.videoCodec.resolution[0]}:${configuration.videoCodec.resolution[1]}:(ow-iw)/2:(oh-ih)/2`,
                    '-force_key_frames', `expr:gte(t,n_forced*${iframeIntervalSeconds})`,
                ];
        }
        else {
            videoArgs = [
                '-vcodec', 'copy',
            ];
        }

        console.log(`motion recording starting`);
        session = await startFFMPegFragmetedMP4Session(inputArguments, audioArgs, videoArgs, console);
    }

    console.log(`motion recording started`);
    const { socket, cp, generator } = session;
    let pending: Buffer[] = [];
    try {
        let i = 0;
        for await (const box of generator) {
            const { header, type, data } = box;
            // console.log('motion fragment box', type);

            // every moov/moof frame designates an iframe?
            pending.push(header, data);

            if (type === 'moov' || type === 'mdat') {
                const fragment = Buffer.concat(pending);
                pending = [];
                console.log(`motion fragment #${++i} sent. size:`, fragment.length);
                yield fragment;
            }
        }
        console.log(`motion recording finished`);
    }
    catch (e) {
        console.log(`motion recording complete ${e}`);
    }
    finally {
        socket?.destroy();
        cp?.kill('SIGKILL');
    }
}
