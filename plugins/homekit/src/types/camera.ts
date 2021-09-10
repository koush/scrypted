
import { Camera, FFMpegInput, MotionSensor, ScryptedDevice, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, VideoCamera, AudioSensor } from '@scrypted/sdk'
import { addSupportedType, DummyDevice } from '../common'
import { AudioStreamingCodec, AudioStreamingCodecType, AudioStreamingSamplerate, CameraController, CameraStreamingDelegate, CameraStreamingOptions, Characteristic, H264Level, H264Profile, PrepareStreamCallback, PrepareStreamRequest, PrepareStreamResponse, SnapshotRequest, SnapshotRequestCallback, SRTPCryptoSuites, StartStreamRequest, StreamingRequest, StreamRequestCallback, StreamRequestTypes } from '../hap';
import { makeAccessory } from './common';

import sdk from '@scrypted/sdk';
import child_process from 'child_process';
import { ChildProcess } from 'child_process';
import dgram from 'dgram';
import { once } from 'events';
import debounce from 'lodash/debounce';

import { CameraRecordingDelegate, CharacteristicEventTypes, CharacteristicValue, NodeCallback } from '../../HAP-NodeJS/src';
import { AudioRecordingCodec, AudioRecordingCodecType, AudioRecordingSamplerate, AudioRecordingSamplerateValues, CameraRecordingConfiguration, CameraRecordingOptions } from '../../HAP-NodeJS/src/lib/camera/RecordingManagement';
import { startFFMPegFragmetedMP4Session } from '@scrypted/common/src/ffmpeg-mp4-parser-session';

const { log, mediaManager, deviceManager } = sdk;

async function getPort(): Promise<{ socket: dgram.Socket, port: number }> {
    const socket = dgram.createSocket('udp4');
    while (true) {
        const port = Math.round(10000 + Math.random() * 30000);
        socket.bind(port);
        await once(socket, 'listening');
        return { socket, port };
    }
}

const iframeIntervalSeconds = 4;
const numberPrebufferSegments = 1;

async function* handleFragmentsRequests(device: ScryptedDevice & VideoCamera & MotionSensor & AudioSensor,
    configuration: CameraRecordingConfiguration): AsyncGenerator<Buffer, void, unknown> {

    console.log('recording session starting', configuration);

    const media = await device.getVideoStream({
        prebuffer: configuration.mediaContainerConfiguration.prebufferLength,
        container: 'mp4',
    });
    const ffmpegInput = JSON.parse((await mediaManager.convertMediaObjectToBuffer(media, ScryptedMimeTypes.FFmpegInput)).toString()) as FFMpegInput;


    const storage = deviceManager.getMixinStorage(device.id);
    const transcodeRecording = storage.getItem('transcodeRecording') === 'true';

    let audioArgs: string[];
    if (transcodeRecording) {
        audioArgs = [
            '-bsf:a', 'aac_adtstoasc',
            '-acodec', 'libfdk_aac',
            ...(configuration.audioCodec.type === AudioRecordingCodecType.AAC_LC ?
                ['-profile:a', 'aac_low'] :
                ['-profile:a', 'aac_eld']),
            '-ar', `${AudioRecordingSamplerateValues[configuration.audioCodec.samplerate]}k`,
            '-b:a', `${configuration.audioCodec.bitrate}k`,
            '-ac', `${configuration.audioCodec.audioChannels}`
        ];
    }
    else {
        audioArgs = [
            '-bsf:a', 'aac_adtstoasc',
            '-acodec', 'copy'
        ];
    }

    const profile = configuration.videoCodec.profile === H264Profile.HIGH ? 'high'
        : configuration.videoCodec.profile === H264Profile.MAIN ? 'main' : 'baseline';

    const level = configuration.videoCodec.level === H264Level.LEVEL4_0 ? '4.0'
        : configuration.videoCodec.level === H264Level.LEVEL3_2 ? '3.2' : '3.1';


    let videoArgs: string[];
    if (transcodeRecording) {
        videoArgs = [
            '-profile:v', profile,
            '-level:v', level,
            '-b:v', `${configuration.videoCodec.bitrate}k`,
            '-force_key_frames', `expr:gte(t,n_forced*${iframeIntervalSeconds})`,
            '-r', configuration.videoCodec.resolution[2].toString(),
            '-vf', `scale=w=${configuration.videoCodec.resolution[0]}:h=${configuration.videoCodec.resolution[1]}:force_original_aspect_ratio=1,pad=${configuration.videoCodec.resolution[0]}:${configuration.videoCodec.resolution[1]}:(ow-iw)/2:(oh-ih)/2`,
        ];
    }
    else {
        videoArgs = [
            '-vcodec', 'copy',
            // should this be behind a flag?
            // '-frag_duration', `${configuration.mediaContainerConfiguration.fragmentLength * 1000}`,
        ];
    }

    log.i(`${device.name} motion recording starting`);
    const session = await startFFMPegFragmetedMP4Session(ffmpegInput, audioArgs, videoArgs);
    log.i(`${device.name} motion recording started`);
    const { socket, cp, generator } = session;
    let pending: Buffer[] = [];
    try {
        for await (const box of generator) {
            const { header, type, length, data } = box;

            // every moov/moof frame designates an iframe?
            pending.push(header, data);

            if (type === 'moov' || type === 'mdat') {
                const fragment = Buffer.concat(pending);
                pending = [];
                yield fragment;
            }
            // console.log('mp4 box type', type, length);
        }
    }
    catch (e) {
        log.i(`${device.name} motion recording complete ${e}`);
    }
    finally {
        socket.destroy();
        cp.kill();
    }
}

addSupportedType({
    type: ScryptedDeviceType.Camera,
    probe(device: DummyDevice) {
        return device.interfaces.includes(ScryptedInterface.VideoCamera);
    },
    getAccessory(device: ScryptedDevice & VideoCamera & Camera & MotionSensor & AudioSensor) {
        interface Session {
            request: PrepareStreamRequest;
            videossrc: number;
            audiossrc: number;
            cp: ChildProcess;
            videoReturn: dgram.Socket;
            audioReturn: dgram.Socket;
        }
        const sessions = new Map<string, Session>();

        let lastPicture = 0;
        let picture: Buffer;


        function killSession(sessionID: string) {
            const session = sessions.get(sessionID);

            if (!session)
                return;

            sessions.delete(sessionID);
            session.cp?.kill();
            session.videoReturn?.close();
            session.audioReturn?.close();
        }

        const delegate: CameraStreamingDelegate = {
            async handleSnapshotRequest(request: SnapshotRequest, callback: SnapshotRequestCallback) {
                try {
                    console.log('snapshot request', request);

                    if (device.interfaces.includes(ScryptedInterface.Camera)) {
                        const media = await device.takePicture();
                        const jpeg = await mediaManager.convertMediaObjectToBuffer(media, 'image/jpeg');
                        callback(null, jpeg);
                        return;
                    }
                    if (lastPicture + 60000 > Date.now()) {
                        callback(null, picture);
                        return;
                    }

                    lastPicture = Date.now();
                    callback(null, picture);

                    try {
                        // begin a refresh
                        const media = await device.getVideoStream();
                        picture = await mediaManager.convertMediaObjectToBuffer(media, 'image/jpeg');
                    }
                    catch (e) {
                    }
                }
                catch (e) {
                    console.error('snapshot error', e);
                    callback(e);
                }
            },
            async prepareStream(request: PrepareStreamRequest, callback: PrepareStreamCallback) {

                const videossrc = CameraController.generateSynchronisationSource();
                const audiossrc = CameraController.generateSynchronisationSource();

                const { socket: videoReturn, port: videoPort } = await getPort();
                const { socket: audioReturn, port: audioPort } = await getPort();

                const session: Session = {
                    request,
                    videossrc,
                    audiossrc,
                    cp: null,
                    videoReturn,
                    audioReturn,
                }
                sessions.set(request.sessionID, session);

                const response: PrepareStreamResponse = {
                    video: {
                        srtp_key: request.video.srtp_key,
                        srtp_salt: request.video.srtp_salt,
                        port: videoPort,
                        ssrc: videossrc,
                    },
                    audio: {
                        srtp_key: request.audio.srtp_key,
                        srtp_salt: request.audio.srtp_salt,
                        port: audioPort,
                        ssrc: audiossrc,
                    }
                }

                // plugin scope or device scope?
                const addressOverride = localStorage.getItem('addressOverride');
                if (addressOverride) {
                    console.log('using address override', addressOverride);
                    response.addressOverride = addressOverride;
                }

                callback(null, response);
            },
            async handleStreamRequest(request: StreamingRequest, callback: StreamRequestCallback) {
                console.log('streaming request', request);
                if (request.type === StreamRequestTypes.STOP) {
                    killSession(request.sessionID);
                    callback();
                    return;
                }

                const session = sessions.get(request.sessionID);

                if (!session) {
                    callback(new Error('unknown session'));
                    return;
                }
                if (request.type === StreamRequestTypes.RECONFIGURE) {
                    // stop for restart
                    session.cp?.kill();
                    session.cp = undefined;
                }

                // watch for data to verify other side is alive.
                session.videoReturn.on('data', () => debounce(() => {
                    controller.forceStopStreamingSession(request.sessionID);
                    killSession(request.sessionID);
                }, 60000));


                callback();


                const videomtu = 188 * 3;
                const audiomtu = 188 * 1;

                try {
                    const media = await device.getVideoStream();
                    const ffmpegInput = JSON.parse((await mediaManager.convertMediaObjectToBuffer(media, ScryptedMimeTypes.FFmpegInput)).toString()) as FFMpegInput;

                    const videoKey = Buffer.concat([session.request.video.srtp_key, session.request.video.srtp_salt]);
                    const audioKey = Buffer.concat([session.request.audio.srtp_key, session.request.audio.srtp_salt]);
                    const args: string[] = [];
                    args.push(...ffmpegInput.inputArguments);
                    args.push(
                        "-an", '-sn', '-dn',
                    );

                    const storage = deviceManager.getMixinStorage(device.id);
                    const transcodeStreaming = storage.getItem('transcodeStreaming') === 'true';

                    if (transcodeStreaming) {
                        args.push(
                            "-vcodec", "libx264",
                            '-pix_fmt', 'yuvj420p',
                            "-profile:v", "high",
                            '-color_range', 'mpeg',
                            "-bf", "0",
                            "-b:v", request.video.max_bit_rate.toString() + "k",
                            "-bufsize", (2 * request.video.max_bit_rate).toString() + "k",
                            "-maxrate", request.video.max_bit_rate.toString() + "k",
                            "-filter:v", "fps=fps=" + request.video.fps.toString(),
                        )
                    }
                    else {
                        args.push(
                            "-vcodec", "copy",
                        );
                    }

                    args.push(
                        "-payload_type", (request as StartStreamRequest).video.pt.toString(),
                        "-ssrc", session.videossrc.toString(),
                        "-f", "rtp",
                        "-srtp_out_suite", session.request.video.srtpCryptoSuite === SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80 ?
                        "AES_CM_128_HMAC_SHA1_80" : "AES_CM_256_HMAC_SHA1_80",
                        "-srtp_out_params", videoKey.toString('base64'),
                        `srtp://${session.request.targetAddress}:${session.request.video.port}?rtcpport=${session.request.video.port}&pkt_size=${videomtu}`
                    )

                    const codec = (request as StartStreamRequest).audio.codec;
                    args.push(
                        "-vn", '-sn', '-dn',
                    );
                    if (false && !transcodeStreaming) {
                        args.push(
                            "-acodec", "copy",
                        );
                    }
                    else if (codec === AudioStreamingCodecType.OPUS || codec === AudioStreamingCodecType.AAC_ELD) {
                        args.push(
                            '-acodec', ...(codec === AudioStreamingCodecType.OPUS ?
                                ['libopus', '-application', 'lowdelay'] :
                                ['libfdk_aac', '-profile:a', 'aac_eld']),
                            '-flags', '+global_header',
                            '-ar', `${(request as StartStreamRequest).audio.sample_rate}k`,
                            '-b:a', `${(request as StartStreamRequest).audio.max_bit_rate}k`,
                            '-ac', `${(request as StartStreamRequest).audio.channel}`,
                            "-payload_type",
                            (request as StartStreamRequest).audio.pt.toString(),
                            "-ssrc", session.audiossrc.toString(),
                            "-srtp_out_suite", session.request.audio.srtpCryptoSuite === SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80 ?
                            "AES_CM_128_HMAC_SHA1_80" : "AES_CM_256_HMAC_SHA1_80",
                            "-srtp_out_params", audioKey.toString('base64'),
                            "-f", "rtp",
                            `srtp://${session.request.targetAddress}:${session.request.audio.port}?rtcpport=${session.request.audio.port}&pkt_size=${audiomtu}`
                        )
                    }
                    else {
                        console.warn('unknown audio codec', request);
                    }

                    console.log(args);

                    const cp = child_process.spawn(await mediaManager.getFFmpegPath(), args, {
                        // stdio: 'ignore',
                    });
                    cp.stdout.on('data', data => console.log(data.toString()));
                    cp.stderr.on('data', data => console.error(data.toString()));

                    session.cp = cp;
                }
                catch (e) {
                    log.e(`stream failed ${e}`);
                    console.error('streaming error', e);
                }
            },
        };

        const codecs: AudioStreamingCodec[] = [];
        for (const type of [AudioStreamingCodecType.OPUS, AudioStreamingCodecType.AAC_ELD]) {
            for (const samplerate of [AudioStreamingSamplerate.KHZ_8, AudioStreamingSamplerate.KHZ_16, AudioStreamingSamplerate.KHZ_24]) {
                codecs.push({
                    type,
                    samplerate,
                    bitrate: 0,
                    audioChannels: 1,
                });
            }
        }

        const streamingOptions: CameraStreamingOptions = {
            video: {
                codec: {
                    levels: [H264Level.LEVEL3_1, H264Level.LEVEL3_2, H264Level.LEVEL4_0],
                    profiles: [H264Profile.MAIN],
                },
                resolutions: [
                    [1280, 720, 15],
                    [1920, 1080, 15],
                ]
            },
            audio: {
                codecs
            },
            supportedCryptoSuites: [
                // not supported by ffmpeg
                // SRTPCryptoSuites.AES_CM_256_HMAC_SHA1_80,
                SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80,
                SRTPCryptoSuites.NONE,
            ]
        }

        let recordingDelegate: CameraRecordingDelegate | undefined;
        let recordingOptions: CameraRecordingOptions | undefined;

        const accessory = makeAccessory(device);

        const storage = deviceManager.getMixinStorage(device.id);
        const detectAudio = storage.getItem('detectAudio') === 'true';
        const needAudioMotionService = device.interfaces.includes(ScryptedInterface.AudioSensor) && detectAudio;

        if (device.interfaces.includes(ScryptedInterface.MotionSensor) || needAudioMotionService) {
            recordingDelegate = {
                handleFragmentsRequests(configuration): AsyncGenerator<Buffer, void, unknown> {
                    return handleFragmentsRequests(device, configuration)
                }
            };

            const recordingCodecs: AudioRecordingCodec[] = [];
            const samplerate: AudioRecordingSamplerate[] = [];
            for (const sr of [AudioRecordingSamplerate.KHZ_32]) {
                samplerate.push(sr);
            }

            for (const type of [AudioRecordingCodecType.AAC_LC]) {
                const entry: AudioRecordingCodec = {
                    type,
                    bitrateMode: 0,
                    samplerate,
                    audioChannels: 1,
                }
                recordingCodecs.push(entry);
            }

            recordingOptions = {
                motionService: true,
                prebufferLength: numberPrebufferSegments * iframeIntervalSeconds * 1000,
                eventTriggerOptions: 0x01,
                mediaContainerConfigurations: [
                    {
                        type: 0,
                        fragmentLength: iframeIntervalSeconds * 1000,
                    }
                ],

                video: {
                    codec: {
                        levels: [H264Level.LEVEL3_1, H264Level.LEVEL3_2, H264Level.LEVEL4_0],
                        profiles: [H264Profile.BASELINE, H264Profile.MAIN, H264Profile.HIGH],
                    },
                    resolutions: [
                        [1280, 720, 30],
                        [1920, 1080, 30],
                    ]
                },
                audio: {
                    codecs: recordingCodecs,
                },
            };
        }

        const controller = new CameraController({
            cameraStreamCount: 2,
            delegate,
            streamingOptions,
            recording: {
                options: recordingOptions,
                delegate: recordingDelegate,
            }
        });

        accessory.configureController(controller);

        if (controller.motionService) {
            const motionDetected = needAudioMotionService ?
                () => device.audioDetected || device.motionDetected :
                () => !!device.motionDetected;

            const service = controller.motionService;
            service.getCharacteristic(Characteristic.MotionDetected)
                .on(CharacteristicEventTypes.GET, (callback: NodeCallback<CharacteristicValue>) => {
                    callback(null, motionDetected());
                });

            device.listen({
                event: ScryptedInterface.MotionSensor,
                watch: false,
            }, (eventSource, eventDetails, data) => {
                service.updateCharacteristic(Characteristic.MotionDetected, motionDetected());
            });

            if (needAudioMotionService) {
                device.listen({
                    event: ScryptedInterface.AudioSensor,
                    watch: false,
                }, (eventSource, eventDetails, data) => {
                    service.updateCharacteristic(Characteristic.MotionDetected, motionDetected());
                });
            }
        }

        return accessory;
    }
});
