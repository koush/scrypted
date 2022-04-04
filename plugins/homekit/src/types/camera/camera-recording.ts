
import { FFMpegFragmentedMP4Session, startFFMPegFragmentedMP4Session } from '@scrypted/common/src/ffmpeg-mp4-parser-session';
import { parseFragmentedMP4 } from '@scrypted/common/src/ffmpeg-mp4-parser-session';
import sdk, { AudioSensor, FFMpegInput, MediaStreamOptions, MotionSensor, ScryptedDevice, ScryptedInterface, ScryptedMimeTypes, VideoCamera } from '@scrypted/sdk';
import net from 'net';
import { Duplex, Writable } from 'stream';
import { HomeKitSession } from '../../common';
import { AudioRecordingCodecType, AudioRecordingSamplerateValues, CameraRecordingConfiguration } from '../../hap';
import { evalRequest } from './camera-transcode';
import fs from 'fs';
import mkdirp from 'mkdirp';
import { getCameraRecordingFiles, HksvVideoClip, VIDEO_CLIPS_NATIVE_ID } from './camera-recording-files';
import { safeKillFFmpeg } from '@scrypted/common/src/media-helpers';

const { log, mediaManager, deviceManager } = sdk;

export const iframeIntervalSeconds = 4;
// have seen strange issues where homekit never terminates the video.
const maxVideoDuration = 3 * 60 * 1000;

export async function* handleFragmentsRequests(device: ScryptedDevice & VideoCamera & MotionSensor & AudioSensor,
    configuration: CameraRecordingConfiguration, console: Console, homekitSession: HomeKitSession): AsyncGenerator<Buffer, void, unknown> {

    console.log(device.name, 'recording session starting', configuration);

    const storage = deviceManager.getMixinStorage(device.id, undefined);
    const saveRecordings = device.mixins.includes(homekitSession.videoClipsId);

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

            let aacLowEncoder = 'aac';
            const forceOpus = homekitSession.storage.getItem('forceOpus') !== 'false';
            if (!forceOpus) {
                aacLowEncoder = 'libfdk_aac';
            }

            audioArgs = [
                ...(configuration.audioCodec.type === AudioRecordingCodecType.AAC_LC ?
                    ['-acodec', aacLowEncoder, '-profile:a', 'aac_low'] :
                    ['-acodec', 'libfdk_aac', '-profile:a', 'aac_eld']),
                '-ar', `${AudioRecordingSamplerateValues[configuration.audioCodec.samplerate]}k`,
                // technically, this should be used for VBR (which this plugin offers).
                // will see about changing it later.
                // '-q:a', '3',
                // this is used for CBR.
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
                // Ran into an issue where the RTSP source had SPS/PPS in the SDP,
                // and none in the bitstream. Codec copy will not add SPS/PPS before IDR frames
                // unless this flag is used.
                // I believe this is causing issues. I think inly FTYP/MOOV should have SPS/PPS?
                // "-bsf:v", "dump_extra",
            ];
        }

        console.log(`motion recording starting`);
        session = await startFFMPegFragmentedMP4Session(inputArguments, audioArgs, videoArgs, console);
    }

    const start = Date.now();
    let recordingFile: Writable;
    const saveFragment = async (i: number, fragment: Buffer) => {
        if (!saveRecordings)
            return;

        try {
            const duration = Date.now() - start;
            const {
                clipId,
                savePath,
                metadataPath,
                mp4Path
            } = await getCameraRecordingFiles(device.id, start);
            mkdirp.sync(savePath);
            if (!recordingFile)
                recordingFile = fs.createWriteStream(mp4Path);
            recordingFile.write(fragment);
            const metadata: HksvVideoClip = {
                id: clipId,
                startTime: start,
                duration,
                fragments: i + 1,
            };
            fs.writeFileSync(metadataPath, Buffer.from(JSON.stringify(metadata)));
        }
        catch (e) {
            console.error('error saving hksv fragment', e);
        }
    };

    // this will cause the generator to close/throw.
    const cleanupPipes = () => {
        socket?.destroy();
        safeKillFFmpeg(cp);
    }

    console.log(`motion recording started`);
    const { socket, cp, generator } = session;
    const videoTimeout = setTimeout(() => {
        console.error('homekit secure video max duration reached');
        cleanupPipes();
    }, maxVideoDuration);

    let pending: Buffer[] = [];
    try {
        let i = 0;
        console.time('mp4 recording');
        // if ffmpeg is being used to parse a prebuffered stream that is NOT mp4 (despite our request),
        // it seems that ffmpeg outputs a bad first fragment. it may be missing various codec informations or
        // starting on a non keyframe. unsure, so skip that one.
        // rebroadcast plugin rtsp mode is the culprit here, and there's no fix. rebroadcast
        // will send an extra fragment, so one can be skipped safely without any loss.
        let needSkip = ffmpegInput.mediaStreamOptions?.prebuffer && ffmpegInput.container !== 'mp4';
        for await (const box of generator) {
            const { header, type, data } = box;
            // console.log('motion fragment box', type);

            // every moov/moof frame designates an iframe?
            pending.push(header, data);

            if (type === 'moov' || type === 'mdat') {
                if (type === 'mdat' && needSkip) {
                    pending = [];
                    needSkip = false;
                    continue;
                }
                const fragment = Buffer.concat(pending);
                saveFragment(i, fragment);
                pending = [];
                console.log(`motion fragment #${++i} sent. size:`, fragment.length);
                // fs.writeFileSync(`/tmp/${device.id}-${i.toString().padStart(2, '0')}.mp4`, fragment);
                yield fragment;
            }
        }
        console.log(`motion recording finished`);
    }
    catch (e) {
        console.log(`motion recording completed with error ${e}`);
    }
    finally {
        clearTimeout(videoTimeout);
        console.timeEnd('mp4 recording');
        cleanupPipes();
        recordingFile?.end();
        recordingFile?.destroy();
        if (saveRecordings) {
            homekitSession.cameraMixins.get(device.id)?.onDeviceEvent(ScryptedInterface.VideoClips, undefined);
            deviceManager.onDeviceEvent(VIDEO_CLIPS_NATIVE_ID, ScryptedInterface.VideoClips, undefined);
        }
    }
}
