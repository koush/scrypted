import { Camera, FFMpegInput, MotionSensor, ScryptedDevice, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, VideoCamera, AudioSensor, Intercom, MediaStreamOptions, ObjectDetection } from '@scrypted/sdk'
import { addSupportedType, DummyDevice, HomeKitSession } from '../common'
import { AudioStreamingCodec, AudioStreamingCodecType, AudioStreamingSamplerate, CameraController, CameraStreamingDelegate, CameraStreamingOptions, Characteristic, H264Level, H264Profile, PrepareStreamCallback, PrepareStreamRequest, PrepareStreamResponse, SRTPCryptoSuites, StartStreamRequest, StreamingRequest, StreamRequestCallback, StreamRequestTypes, Resolution } from '../hap';
import { makeAccessory } from './common';
import { fitHeightToWidth } from "../../../../common/src/resolution-utils";

import sdk from '@scrypted/sdk';
import child_process from 'child_process';
import { ChildProcess } from 'child_process';
import dgram, { SocketType } from 'dgram';
import { once } from 'events';
import debounce from 'lodash/debounce';

import { CameraRecordingDelegate, CharacteristicEventTypes, CharacteristicValue, NodeCallback } from '../../HAP-NodeJS/src';
import { AudioRecordingCodec, AudioRecordingCodecType, AudioRecordingSamplerate, CameraRecordingOptions } from '../../HAP-NodeJS/src/lib/camera/RecordingManagement';
import { ffmpegLogInitialOutput } from '@scrypted/common/src/media-helpers';
import { RtpDemuxer } from '../rtp/rtp-demuxer';
import { HomeKitRtpSink, startRtpSink } from '../rtp/rtp-ffmpeg-input';
import { ContactSensor } from '../../HAP-NodeJS/src/lib/definitions';
import { handleFragmentsRequests, iframeIntervalSeconds } from './camera/camera-recording';
import { createSnapshotHandler } from './camera/camera-snapshot';

const { log, mediaManager, deviceManager, systemManager } = sdk;

async function getPort(socketType?: SocketType): Promise<{ socket: dgram.Socket, port: number }> {
    const socket = dgram.createSocket(socketType || 'udp4');
    while (true) {
        const port = Math.round(10000 + Math.random() * 30000);
        socket.bind(port);
        await once(socket, 'listening');
        return { socket, port };
    }
}

const numberPrebufferSegments = 1;

// request is used by the eval, do not remove.
function evalRequest(value: string, request: any) {
    if (value.startsWith('`'))
        value = eval(value) as string;
    return value.split(' ');
}

addSupportedType({
    type: ScryptedDeviceType.Camera,
    probe(device: DummyDevice) {
        return device.interfaces.includes(ScryptedInterface.VideoCamera);
    },
    async getAccessory(device: ScryptedDevice & VideoCamera & Camera & MotionSensor & AudioSensor & Intercom, homekitSession: HomeKitSession) {
        const console = deviceManager.getMixinConsole
            ? deviceManager.getMixinConsole(device.id, undefined)
            : deviceManager.getDeviceConsole(undefined);

        interface Session {
            prepareRequest: PrepareStreamRequest;
            startRequest: StartStreamRequest;
            videossrc: number;
            audiossrc: number;
            cp: ChildProcess;
            videoReturn: dgram.Socket;
            audioReturn: dgram.Socket;
            demuxer?: RtpDemuxer;
            rtpSink?: HomeKitRtpSink;
            targetAddress?: string;
        }
        const sessions = new Map<string, Session>();

        const twoWayAudio = device.interfaces?.includes(ScryptedInterface.Intercom);

        function killSession(sessionID: string) {
            const session = sessions.get(sessionID);

            if (!session)
                return;

            console.log('streaming session killed');

            sessions.delete(sessionID);
            session.cp?.kill();
            session.videoReturn?.close();
            session.audioReturn?.close();
            session.rtpSink?.destroy();
        }


        const delegate: CameraStreamingDelegate = {
            handleSnapshotRequest: createSnapshotHandler(device, homekitSession),
            async prepareStream(request: PrepareStreamRequest, callback: PrepareStreamCallback) {

                const videossrc = CameraController.generateSynchronisationSource();
                const audiossrc = CameraController.generateSynchronisationSource();

                const socketType = request.addressVersion === 'ipv6' ? 'udp6' : 'udp4';
                const { socket: videoReturn, port: videoPort } = await getPort(socketType);
                const { socket: audioReturn, port: audioPort } = await getPort(socketType);

                const session: Session = {
                    prepareRequest: request,
                    startRequest: null,
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
                console.log(device.name, 'streaming request', request);
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

                callback();

                let selectedStream: MediaStreamOptions;
                if (request.type === StreamRequestTypes.RECONFIGURE) {
                    // not impleemented, this doesn't work.
                    return;

                    // // stop for restart
                    // session.cp?.kill();
                    // session.cp = undefined;

                    // // override the old values for new.
                    // if (request.video) {
                    //     Object.assign(session.startRequest.video, request.video);
                    // }
                    // request = session.startRequest;

                    // const vso = await device.getVideoStreamOptions();
                    // // try to match by bitrate.
                    // for (const check of vso || []) {
                    //     selectedStream = check;
                    //     if (check?.video?.bitrate < request.video.max_bit_rate * 1000) {
                    //         break;
                    //     }
                    // }
                    // console.log('reconfigure selected stream', selectedStream);
                }
                else {
                    session.startRequest = request as StartStreamRequest;
                }

                // watch for data to verify other side is alive.
                session.videoReturn.on('data', () => debounce(() => {
                    controller.forceStopStreamingSession(request.sessionID);
                    killSession(request.sessionID);
                }, 60000));


                const videomtu = 188 * 3;
                const audiomtu = 188 * 1;

                try {
                    console.log(device.name, 'fetching video stream');
                    const media = await device.getVideoStream(selectedStream);
                    const ffmpegInput = JSON.parse((await mediaManager.convertMediaObjectToBuffer(media, ScryptedMimeTypes.FFmpegInput)).toString()) as FFMpegInput;

                    const videoKey = Buffer.concat([session.prepareRequest.video.srtp_key, session.prepareRequest.video.srtp_salt]);
                    const audioKey = Buffer.concat([session.prepareRequest.audio.srtp_key, session.prepareRequest.audio.srtp_salt]);

                    const noAudio = ffmpegInput.mediaStreamOptions && ffmpegInput.mediaStreamOptions.audio === null;
                    const args: string[] = [
                        '-hide_banner',
                    ];

                    const storage = deviceManager.getMixinStorage(device.id, undefined);

                    // decoder arguments
                    const videoDecoderArguments = storage.getItem('videoDecoderArguments') || '';
                    if (videoDecoderArguments) {
                        args.push(...evalRequest(videoDecoderArguments, request));
                    }

                    // ffmpeg input for decoder
                    args.push(...ffmpegInput.inputArguments);

                    // dummy audio
                    if (!noAudio) {
                        // create a dummy audio track if none actually exists.
                        // this track will only be used if no audio track is available.
                        // https://stackoverflow.com/questions/37862432/ffmpeg-output-silent-audio-track-if-source-has-no-audio-or-audio-is-shorter-th
                        args.push('-f', 'lavfi', '-i', 'anullsrc=cl=1', '-shortest');
                    }

                    // video encoding
                    args.push(
                        "-an", '-sn', '-dn',
                    );

                    const transcodeStreaming = storage.getItem('transcodeStreaming') === 'true';

                    if (transcodeStreaming) {
                        const h264EncoderArguments = storage.getItem('h264EncoderArguments') || '';
                        const vcodec = h264EncoderArguments
                            ? evalRequest(h264EncoderArguments, request) :
                            [
                                "-vcodec", "libx264",
                                '-pix_fmt', 'yuvj420p',
                                "-profile:v", "high",
                                '-color_range', 'mpeg',
                                "-bf", "0",
                                "-b:v", request.video.max_bit_rate.toString() + "k",
                                "-bufsize", (2 * request.video.max_bit_rate).toString() + "k",
                                "-maxrate", request.video.max_bit_rate.toString() + "k",
                                "-filter:v", "fps=fps=" + request.video.fps.toString(),
                            ];

                        args.push(
                            ...vcodec,
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
                        "-srtp_out_suite", session.prepareRequest.video.srtpCryptoSuite === SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80 ?
                        "AES_CM_128_HMAC_SHA1_80" : "AES_CM_256_HMAC_SHA1_80",
                        "-srtp_out_params", videoKey.toString('base64'),
                        `srtp://${session.prepareRequest.targetAddress}:${session.prepareRequest.video.port}?rtcpport=${session.prepareRequest.video.port}&pkt_size=${videomtu}`
                    )

                    // audio encoding
                    if (!noAudio) {
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
                                "-srtp_out_suite", session.prepareRequest.audio.srtpCryptoSuite === SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80 ?
                                "AES_CM_128_HMAC_SHA1_80" : "AES_CM_256_HMAC_SHA1_80",
                                "-srtp_out_params", audioKey.toString('base64'),
                                "-f", "rtp",
                                `srtp://${session.prepareRequest.targetAddress}:${session.prepareRequest.audio.port}?rtcpport=${session.prepareRequest.audio.port}&pkt_size=${audiomtu}`
                            )
                        }
                        else {
                            console.warn(device.name, 'unknown audio codec', request);
                        }
                    }

                    console.log(device.name, args);

                    const cp = child_process.spawn(await mediaManager.getFFmpegPath(), args);
                    ffmpegLogInitialOutput(console, cp);

                    session.cp = cp;

                    // audio talkback
                    if (twoWayAudio) {
                        session.demuxer = new RtpDemuxer(device.name, console, session.audioReturn);
                        const socketType = session.prepareRequest.addressVersion === 'ipv6' ? 'udp6' : 'udp4';

                        session.rtpSink = await startRtpSink(socketType, session.prepareRequest.targetAddress,
                            audioKey, (request as StartStreamRequest).audio.sample_rate, console);

                        session.demuxer.on('rtp', (buffer: Buffer) => {
                            session.audioReturn.send(buffer, session.rtpSink.rtpPort);
                        });

                        session.demuxer.on('rtcp', (buffer: Buffer) => {
                            session.rtpSink.heartbeat(session.audioReturn, buffer);
                        });

                        const mo = mediaManager.createFFmpegMediaObject(session.rtpSink.ffmpegInput);
                        device.startIntercom(mo);
                    }
                }
                catch (e) {
                    console.error(device.name, 'streaming error', e);
                }
            },
        };

        const codecs: AudioStreamingCodec[] = [];
        // multiple audio options can be provided but lets stick with AAC ELD 24k,
        // that's what the talkback ffmpeg session in rtp-ffmpeg-input.ts will use.
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

        let msos: MediaStreamOptions[];
        try {
            msos = await device.getVideoStreamOptions();
        }
        catch (e) {
        }

        const nativeResolutions: Resolution[] = [];
        if (msos) {
            for (const mso of msos) {
                if (!mso.video)
                    continue;
                const { width, height } = mso.video;
                if (!width || !height)
                    continue;
                nativeResolutions.push(
                    [width, height, mso.video.fps || 30]
                );
            }
        }

        function ensureHasWidthResolution(resolutions: Resolution[], width: number, defaultHeight: number) {
            if (resolutions.find(res => res[0] === width))
                return;
            const topVideo = msos?.[0]?.video;

            if (!topVideo || !topVideo?.width || !topVideo?.height) {
                resolutions.push([width, defaultHeight, 30]);
                return;
            }

            resolutions.unshift(
                [
                    width,
                    fitHeightToWidth(topVideo.width, topVideo.height, width),
                    topVideo.fps || 30,
                ]);
        }

        const streamingResolutions = [...nativeResolutions];
        // needed for apple watch
        ensureHasWidthResolution(streamingResolutions, 320, 240);
        // i think these are required by homekit?
        ensureHasWidthResolution(streamingResolutions, 1280, 720);
        ensureHasWidthResolution(streamingResolutions, 1920, 1080);

        const streamingOptions: CameraStreamingOptions = {
            video: {
                codec: {
                    levels: [H264Level.LEVEL3_1, H264Level.LEVEL3_2, H264Level.LEVEL4_0],
                    profiles: [H264Profile.MAIN],
                },

                resolutions: streamingResolutions,
            },
            audio: {
                codecs,
                twoWayAudio,
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

        const storage = deviceManager.getMixinStorage(device.id, undefined);
        const detectAudio = storage.getItem('detectAudio') === 'true';
        const needAudioMotionService = device.interfaces.includes(ScryptedInterface.AudioSensor) && detectAudio;
        const linkedMotionSensor = storage.getItem('linkedMotionSensor');

        if (linkedMotionSensor || device.interfaces.includes(ScryptedInterface.MotionSensor) || needAudioMotionService) {
            recordingDelegate = {
                prepareRecording(recording) {
                    console.log('prepareRecording', recording);
                },
                handleFragmentsRequests(configuration): AsyncGenerator<Buffer, void, unknown> {
                    return handleFragmentsRequests(device, configuration, console)
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

            const recordingResolutions = [...nativeResolutions];
            ensureHasWidthResolution(recordingResolutions, 1280, 720);
            ensureHasWidthResolution(recordingResolutions, 1920, 1080);

            console.log(device.name, recordingResolutions);

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
                    resolutions: recordingResolutions,
                },
                audio: {
                    codecs: recordingCodecs,
                },
            };
        }

        const controller = new CameraController({
            cameraStreamCount: 8,
            delegate,
            streamingOptions,
            recording: {
                options: recordingOptions,
                delegate: recordingDelegate,
            }
        });

        accessory.configureController(controller);

        if (controller.motionService) {
            const motionDevice = systemManager.getDeviceById<MotionSensor & AudioSensor>(linkedMotionSensor) || device;
            if (!motionDevice) {
                return;
            }

            const motionDetected = needAudioMotionService ?
                () => motionDevice.audioDetected || motionDevice.motionDetected :
                () => !!motionDevice.motionDetected;

            const service = controller.motionService;
            service.getCharacteristic(Characteristic.MotionDetected)
                .on(CharacteristicEventTypes.GET, (callback: NodeCallback<CharacteristicValue>) => {
                    callback(null, motionDetected());
                });

            motionDevice.listen({
                event: ScryptedInterface.MotionSensor,
                watch: false,
            }, (eventSource, eventDetails, data) => {
                service.updateCharacteristic(Characteristic.MotionDetected, motionDetected());
            });

            if (needAudioMotionService) {
                motionDevice.listen({
                    event: ScryptedInterface.AudioSensor,
                    watch: false,
                }, (eventSource, eventDetails, data) => {
                    service.updateCharacteristic(Characteristic.MotionDetected, motionDetected());
                });
            }
        }

        const objectDetectionContactSensorsValue = storage.getItem('objectDetectionContactSensors');
        const objectDetectionContactSensors: string[] = [];
        try {
            objectDetectionContactSensors.push(...JSON.parse(objectDetectionContactSensorsValue));
        }
        catch (e) {
        }

        const sensorMap = new Map<string, ContactSensor>();
        for (const ojs of new Set(objectDetectionContactSensors)) {
            const sensor = new ContactSensor(`${device.name} Object Detection:` + ojs, ojs);
            sensor?.updateCharacteristic(Characteristic.ContactSensorState, Characteristic.ContactSensorState.CONTACT_DETECTED);
            accessory.addService(sensor);
            sensorMap.set(ojs, sensor);
        }

        if (sensorMap.size) {
            device.listen(ScryptedInterface.ObjectDetector, (eventSource, eventDetails, eventData: ObjectDetection) => {
                const all: string[] = [];
                if (eventData.detections)
                    all.push(...eventData.detections.map(d => d.className));
                if (eventData.people)
                    all.push(...eventData.people.map(p => p.label));

                const unset = new Set(sensorMap.keys());
                for (const type of all) {
                    const sensor = sensorMap.get(type);
                    sensor?.updateCharacteristic(Characteristic.ContactSensorState, Characteristic.ContactSensorState.CONTACT_NOT_DETECTED);
                    unset.delete(type);
                }
                for (const type of unset) {
                    const sensor = sensorMap.get(type);
                    sensor?.updateCharacteristic(Characteristic.ContactSensorState, Characteristic.ContactSensorState.CONTACT_DETECTED);
                }
            });
        }

        return accessory;
    }
});
