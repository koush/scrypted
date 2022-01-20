import { Camera, FFMpegInput, MotionSensor, ScryptedDevice, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, VideoCamera, AudioSensor, Intercom, MediaStreamOptions, ObjectsDetected, VideoCameraConfiguration, OnOff } from '@scrypted/sdk'
import { addSupportedType, bindCharacteristic, DummyDevice, HomeKitSession } from '../common'
import { AudioStreamingCodec, AudioStreamingCodecType, AudioStreamingSamplerate, CameraController, CameraStreamingDelegate, CameraStreamingOptions, Characteristic, VideoCodecType, H264Level, H264Profile, PrepareStreamCallback, PrepareStreamRequest, PrepareStreamResponse, SRTPCryptoSuites, StartStreamRequest, StreamingRequest, StreamRequestCallback, StreamRequestTypes } from '../hap';
import { makeAccessory } from './common';

import sdk from '@scrypted/sdk';
import child_process from 'child_process';
import { ChildProcess } from 'child_process';
import dgram, { SocketType } from 'dgram';
import { once } from 'events';
import debounce from 'lodash/debounce';

import { CameraRecordingDelegate } from '../hap';
import { AudioRecordingCodec, AudioRecordingCodecType, AudioRecordingSamplerate, CameraRecordingOptions } from 'hap-nodejs/src/lib/camera/RecordingManagement';
import { ffmpegLogInitialOutput } from '@scrypted/common/src/media-helpers';
import { RtpDemuxer } from '../rtp/rtp-demuxer';
import { HomeKitRtpSink, startRtpSink } from '../rtp/rtp-ffmpeg-input';
import { ContactSensor } from 'hap-nodejs/src/lib/definitions';
import { handleFragmentsRequests, iframeIntervalSeconds } from './camera/camera-recording';
import { createSnapshotHandler } from './camera/camera-snapshot';
import { evalRequest } from './camera/camera-transcode';
import { CharacteristicEventTypes, DataStreamConnection, Service, WithUUID } from 'hap-nodejs/src';
import { RecordingManagement } from 'hap-nodejs/src/lib/camera';
import { defaultObjectDetectionContactSensorTimeout } from '../camera-mixin';
import os from 'os';
import { levelToFfmpeg, profileToFfmpeg } from './camera/camera-utils';

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
const v4Regex = /^[\d]{1,3}\.[\d]{1,3}\.[\d]{1,3}\.[\d]{1,3}$/
const v4v6Regex = /^::ffff:[\d]{1,3}\.[\d]{1,3}\.[\d]{1,3}\.[\d]{1,3}$/;

addSupportedType({
    type: ScryptedDeviceType.Camera,
    probe(device: DummyDevice) {
        return device.interfaces.includes(ScryptedInterface.VideoCamera);
    },
    async getAccessory(device: ScryptedDevice & VideoCamera & VideoCameraConfiguration & Camera & MotionSensor & AudioSensor & Intercom & OnOff, homekitSession: HomeKitSession) {
        const console = deviceManager.getMixinConsole(device.id, undefined);

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
        }
        const sessions = new Map<string, Session>();

        const twoWayAudio = device.interfaces?.includes(ScryptedInterface.Intercom);

        function killSession(sessionID: string) {
            const session = sessions.get(sessionID);

            if (!session)
                return;

            console.log('streaming session killed');

            sessions.delete(sessionID);
            session.cp?.kill('SIGKILL');
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
                else {
                    // HAP-NodeJS has weird default address determination behavior. Ideally it should use
                    // the same IP address as the incoming socket, because that is by definition reachable.
                    // But it seems to rechoose a matching address based on the interface. This guessing
                    // can be error prone if that interface offers multiple addresses, some of which
                    // may not be reachable.
                    // Return the incoming address, assuming the sanity checks pass. Otherwise, fall through
                    // to the HAP-NodeJS implementation.
                    let check: string;
                    if (request.addressVersion === 'ipv4') {
                        const localAddress = request.connection.localAddress;
                        if (v4Regex.exec(localAddress)) {
                            check = localAddress;
                        }
                        else if (v4v6Regex.exec(localAddress)) {
                            // if this is a v4 over v6 address, parse it out.
                            check = localAddress.substring('::ffff:'.length);
                        }
                    }
                    else if (request.addressVersion === 'ipv6' && !v4Regex.exec(request.connection.localAddress)) {
                        check = request.connection.localAddress;
                    }

                    // sanity check this address.
                    if (check) {
                        const infos = os.networkInterfaces()[request.connection.networkInterface];
                        if (infos && infos.find(info => info.address === check)) {
                            response.addressOverride = check;
                        }
                    }
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

                callback();

                let selectedStream: MediaStreamOptions;

                const isHomeKitHub = homekitSession.isHomeKitHub(session.prepareRequest?.targetAddress);
                const streamingChannel = isHomeKitHub
                    ? storage.getItem('streamingChannelHub')
                    : storage.getItem('streamingChannel');
                if (streamingChannel) {
                    const msos = await device.getVideoStreamOptions();
                    selectedStream = msos.find(mso => mso.name === streamingChannel);
                }

                const tryReconfigureBitrate = () => {
                    if (!isHomeKitHub)
                        return;

                    if (!device.interfaces.includes(ScryptedInterface.VideoCameraConfiguration))
                        return;

                    const dynamicBitrate = storage.getItem('dynamicBitrate') === 'true';
                    if (!dynamicBitrate)
                        return;

                    const reconfigured: MediaStreamOptions = Object.assign({
                        video: {
                        },
                    }, selectedStream || {});
                    const bitrate = request.video.max_bit_rate * 1000;
                    reconfigured.video.bitrate = bitrate;

                    device.setVideoStreamOptions(reconfigured);
                    console.log('reconfigure selected stream', selectedStream);
                }

                if (request.type === StreamRequestTypes.RECONFIGURE) {
                    tryReconfigureBitrate();
                    return;
                }
                else {
                    session.startRequest = request as StartStreamRequest;
                }
                tryReconfigureBitrate();

                // watch for data to verify other side is alive.
                session.videoReturn.on('data', () => debounce(() => {
                    controller.forceStopStreamingSession(request.sessionID);
                    killSession(request.sessionID);
                }, 60000));


                const videomtu = request.video.mtu;
                // 400 seems fine? no idea what to use here. this is the mtu for sending audio to homekit.
                // from my observation of talkback packets, the max packet size is ~370, so
                // I'm just guessing that HomeKit wants something similar for the audio it receives.
                // going higher causes choppiness. going lower may cause other issues.
                let audiomtu = 400;

                try {
                    console.log('fetching video stream');
                    const media = await device.getVideoStream(selectedStream);
                    const ffmpegInput = JSON.parse((await mediaManager.convertMediaObjectToBuffer(media, ScryptedMimeTypes.FFmpegInput)).toString()) as FFMpegInput;

                    const videoKey = Buffer.concat([session.prepareRequest.video.srtp_key, session.prepareRequest.video.srtp_salt]);
                    const audioKey = Buffer.concat([session.prepareRequest.audio.srtp_key, session.prepareRequest.audio.srtp_salt]);

                    const noAudio = ffmpegInput.mediaStreamOptions && ffmpegInput.mediaStreamOptions.audio === null;
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
                                '-preset', 'ultrafast', '-tune', 'zerolatency',
                                '-pix_fmt', 'yuv420p',
                                '-color_range', 'mpeg',
                                "-bf", "0",
                                "-profile:v", profileToFfmpeg(request.video.profile),
                                '-level:v', levelToFfmpeg(request.video.level),
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

                        // homekit live streaming seems extremely picky about aac output.
                        // so currently always transcode audio.
                        if (false && !transcodeStreaming) {
                            args.push(
                                "-acodec", "copy",
                            );
                        }
                        else if (audioCodec === AudioStreamingCodecType.OPUS || audioCodec === AudioStreamingCodecType.AAC_ELD) {
                            args.push(
                                '-acodec', ...(audioCodec === AudioStreamingCodecType.OPUS ?
                                    [
                                        'libopus', '-application', 'lowdelay',
                                        '-frame_duration', (request as StartStreamRequest).audio.packet_time.toString(),
                                    ] :
                                    ['libfdk_aac', '-profile:a', 'aac_eld']),
                                '-flags', '+global_header',
                                '-ar', `${(request as StartStreamRequest).audio.sample_rate}k`,
                                '-b:a', `${(request as StartStreamRequest).audio.max_bit_rate}k`,
                                "-bufsize", `${(request as StartStreamRequest).audio.max_bit_rate * 4}`,
                                '-ac', `${(request as StartStreamRequest).audio.channel}`,
                                "-payload_type",
                                (request as StartStreamRequest).audio.pt.toString(),
                                "-ssrc", session.audiossrc.toString(),
                                "-srtp_out_suite", session.prepareRequest.audio.srtpCryptoSuite === SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80 ?
                                "AES_CM_128_HMAC_SHA1_80" : "AES_CM_256_HMAC_SHA1_80",
                                "-srtp_out_params", audioKey.toString('base64'),
                                // not sure this works.
                                // '-fflags', '+flush_packets', '-flush_packets', '1',
                                "-f", "rtp",
                                `srtp://${session.prepareRequest.targetAddress}:${session.prepareRequest.audio.port}?rtcpport=${session.prepareRequest.audio.port}&pkt_size=${audiomtu}`
                            )
                        }
                        else {
                            console.warn(device.name, 'unknown audio codec, audio will not be streamed.', request);
                        }
                    }

                    if (!sessions.has(request.sessionID)) {
                        console.log('session ended before streaming could start. bailing.');
                        return;
                    }

                    console.log('ffmpeg args', args);

                    const cp = child_process.spawn(await mediaManager.getFFmpegPath(), args);
                    ffmpegLogInitialOutput(console, cp);

                    session.cp = cp;

                    // audio talkback
                    if (twoWayAudio) {
                        session.demuxer = new RtpDemuxer(console, session.audioReturn);
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
                    console.error('streaming error', e);
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

        // const msos = await device.getVideoStreamOptions();

        // const nativeResolutions: Resolution[] = [];
        // if (msos) {
        //     for (const mso of msos) {
        //         if (!mso.video)
        //             continue;
        //         const { width, height } = mso.video;
        //         if (!width || !height)
        //             continue;
        //         nativeResolutions.push(
        //             [width, height, mso.video.fps || 30]
        //         );
        //     }
        // }

        // function ensureHasWidthResolution(resolutions: Resolution[], width: number, defaultHeight: number) {
        //     if (resolutions.find(res => res[0] === width))
        //         return;
        //     const topVideo = msos?.[0]?.video;

        //     if (!topVideo || !topVideo?.width || !topVideo?.height) {
        //         resolutions.unshift([width, defaultHeight, 30]);
        //         return;
        //     }

        //     resolutions.unshift(
        //         [
        //             width,
        //             fitHeightToWidth(topVideo.width, topVideo.height, width),
        //             topVideo.fps || 30,
        //         ]);
        // }

        // const streamingResolutions = [...nativeResolutions];
        // // needed for apple watch
        // ensureHasWidthResolution(streamingResolutions, 320, 240);
        // // i think these are required by homekit?
        // ensureHasWidthResolution(streamingResolutions, 1280, 720);
        // ensureHasWidthResolution(streamingResolutions, 1920, 1080);

        const storage = deviceManager.getMixinStorage(device.id, undefined);
        const h265Support = storage.getItem('h265Support') === 'true';
        const codecType = h265Support ? VideoCodecType.H265 : VideoCodecType.H264

        const streamingOptions: CameraStreamingOptions = {
            video: {
                codec: {
                    type: VideoCodecType.H264,
                    levels: [H264Level.LEVEL3_1, H264Level.LEVEL3_2, H264Level.LEVEL4_0],
                    profiles: [H264Profile.MAIN],
                },

                resolutions: [
                    // 3840x2160@30 (4k).
                    [3840, 2160, 30],
                    // 1920x1080@30 (1080p).
                    [1920, 1080, 30],
                    // 1280x720@30 (720p).
                    [1280, 720, 30],
                    // 320x240@15 (Apple Watch).
                    [320, 240, 15],
                ]
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

        const detectAudio = storage.getItem('detectAudio') === 'true';
        const needAudioMotionService = device.interfaces.includes(ScryptedInterface.AudioSensor) && detectAudio;
        const linkedMotionSensor = storage.getItem('linkedMotionSensor');

        const storageKeySelectedRecordingConfiguration = 'selectedRecordingConfiguration';

        if (linkedMotionSensor || device.interfaces.includes(ScryptedInterface.MotionSensor) || needAudioMotionService) {
            recordingDelegate = {
                handleFragmentsRequests(connection: DataStreamConnection): AsyncGenerator<Buffer, void, unknown> {
                    homekitSession.detectedHomeKitHub(connection.remoteAddress);
                    const configuration = RecordingManagement.parseSelectedConfiguration(storage.getItem(storageKeySelectedRecordingConfiguration))
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

            // const recordingResolutions = [...nativeResolutions];
            // ensureHasWidthResolution(recordingResolutions, 1280, 720);
            // ensureHasWidthResolution(recordingResolutions, 1920, 1080);

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
                        type: codecType,
                        levels: [H264Level.LEVEL3_1, H264Level.LEVEL3_2, H264Level.LEVEL4_0],
                        profiles: [H264Profile.BASELINE, H264Profile.MAIN, H264Profile.HIGH],
                    },
                    resolutions: [
                        [1280, 720, 30],
                        [1920, 1080, 30],
                    ],
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
                () => !!motionDevice.audioDetected || !!motionDevice.motionDetected :
                () => !!motionDevice.motionDetected;

            const { motionService } = controller;
            bindCharacteristic(motionDevice,
                ScryptedInterface.MotionSensor,
                motionService,
                Characteristic.MotionDetected,
                () => motionDetected(), true)

            const { recordingManagement } = controller;

            const persistBooleanCharacteristic = (service: Service, characteristic: WithUUID<{ new(): Characteristic }>) => {
                const property = `characteristic-v2-${characteristic.UUID}`
                service.getCharacteristic(characteristic)
                    .on(CharacteristicEventTypes.GET, callback => callback(null, storage.getItem(property) === 'true' ? 1 : 0))
                    .on(CharacteristicEventTypes.SET, (value, callback) => {
                        callback();
                        storage.setItem(property, (!!value).toString());
                    });
            }

            persistBooleanCharacteristic(recordingManagement.getService(), Characteristic.Active);
            persistBooleanCharacteristic(recordingManagement.getService(), Characteristic.RecordingAudioActive);
            persistBooleanCharacteristic(controller.cameraOperatingModeService, Characteristic.EventSnapshotsActive);
            persistBooleanCharacteristic(controller.cameraOperatingModeService, Characteristic.HomeKitCameraActive);
            persistBooleanCharacteristic(controller.cameraOperatingModeService, Characteristic.PeriodicSnapshotsActive);

            if (!device.interfaces.includes(ScryptedInterface.OnOff)) {
                persistBooleanCharacteristic(controller.cameraOperatingModeService, Characteristic.CameraOperatingModeIndicator);
            }
            else {
                const indicator = controller.cameraOperatingModeService.getCharacteristic(Characteristic.CameraOperatingModeIndicator);
                bindCharacteristic(device, ScryptedInterface.OnOff, controller.cameraOperatingModeService, Characteristic.CameraOperatingModeIndicator, () => device.on ? 1 : 0);
                indicator.on(CharacteristicEventTypes.SET, (value, callback) => {
                    callback();
                    if (value)
                        device.turnOn();
                    else
                        device.turnOff();
                })
            }

            recordingManagement.getService().getCharacteristic(Characteristic.SelectedCameraRecordingConfiguration)
                .on(CharacteristicEventTypes.GET, callback => {
                    callback(null, storage.getItem(storageKeySelectedRecordingConfiguration) || '');
                })
                .on(CharacteristicEventTypes.SET, (value, callback) => {
                    // prepare recording here if necessary.
                    storage.setItem(storageKeySelectedRecordingConfiguration, value.toString());
                    callback();
                });
        }


        if (device.interfaces.includes(ScryptedInterface.ObjectDetector)) {
            const objectDetectionContactSensorsValue = storage.getItem('objectDetectionContactSensors');
            const objectDetectionContactSensors: string[] = [];
            try {
                objectDetectionContactSensors.push(...JSON.parse(objectDetectionContactSensorsValue));
            }
            catch (e) {
            }

            for (const ojs of new Set(objectDetectionContactSensors)) {
                const sensor = new ContactSensor(`${device.name}: ` + ojs, ojs);
                accessory.addService(sensor);

                let contactState = Characteristic.ContactSensorState.CONTACT_DETECTED;
                let timeout: NodeJS.Timeout;

                const resetSensorTimeout = () => {
                    clearTimeout(timeout);
                    timeout = setTimeout(() => {
                        contactState = Characteristic.ContactSensorState.CONTACT_DETECTED;
                        sensor.updateCharacteristic(Characteristic.ContactSensorState, contactState);
                    }, (parseInt(storage.getItem('objectDetectionContactSensorTimeout')) || defaultObjectDetectionContactSensorTimeout) * 1000)
                }

                bindCharacteristic(device, ScryptedInterface.ObjectDetector, sensor, Characteristic.ContactSensorState, (source, details, data) => {
                    if (!source)
                        return contactState;

                    const ed: ObjectsDetected = data;
                    if (!ed.detections)
                        return contactState;

                    const objects = ed.detections.map(d => d.className);
                    if (objects.includes(ojs)) {
                        contactState = Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
                        resetSensorTimeout();
                    }

                    return contactState;
                }, true);
            }
        }

        return accessory;
    }
});
