
import { Camera, FFMpegInput, MotionSensor, ScryptedDevice, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, VideoCamera } from '@scrypted/sdk'
import { addSupportedType, DummyDevice, listenCharacteristic } from '../common'
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
import { Readable } from 'stream';
import { listenZeroCluster } from '../listen-cluster';
import { createServer, Socket } from 'net';
import { SelectedCameraRecordingConfiguration } from '../../HAP-NodeJS/src/lib/definitions';
import fs from "fs";

const { mediaManager } = sdk;

async function getPort(): Promise<dgram.Socket> {
    const ret = dgram.createSocket('udp4');
    while (true) {
        ret.bind(Math.round(10000 + Math.random() * 30000));
        await once(ret, 'listening');
        return ret;
    }
}

async function readLength(readable: Readable, length: number): Promise<Buffer> {
    if (!length) {
        return Buffer.alloc(0);
    }

    {
        const ret = readable.read(length);
        if (ret) {
            return ret;
        }
    }

    return new Promise((resolve, reject) => {
        const r = () => {
            const ret = readable.read(length);
            if (ret) {
                cleanup();
                resolve(ret);
            }
        };

        const e = () => {
            cleanup();
            reject(new Error(`stream ended during read for minimum ${length} bytes`))
        };

        const cleanup = () => {
            readable.removeListener('readable', r);
            readable.removeListener('end', e);
        }

        readable.on('readable', r);
        readable.on('end', e);
    });
}

interface FFMpegParserSession {
    socket: Socket;
    cp: ChildProcess;
}


const iframeIntervalSeconds = 4;
const numberPrebufferSegments = 2;

async function* handleFragmentsRequests(device: ScryptedDevice & VideoCamera & MotionSensor,
    configuration: CameraRecordingConfiguration): AsyncGenerator<Buffer, void, unknown> {
    const media = await device.getVideoStream();
    const ffmpegInput = JSON.parse((await mediaManager.convertMediaObjectToBuffer(media, ScryptedMimeTypes.FFmpegInput)).toString()) as FFMpegInput;

    const session: FFMpegParserSession = await new Promise(async (resolve) => {
        const server = createServer(socket => {
            server.close();
            resolve({ socket, cp });
        });
        const serverPort = await listenZeroCluster(server);

        const args = ffmpegInput.inputArguments.slice();

        args.push(
            '-acodec', ...(configuration.audioCodec.type === AudioRecordingCodecType.AAC_LC ?
                ['libfdk_aac', '-profile:a', 'aac_low'] :
                ['libfdk_aac', '-profile:a', 'aac_eld']),
                '-ar', `${AudioRecordingSamplerateValues[configuration.audioCodec.samplerate]}k`,
                '-b:a', `${configuration.audioCodec.bitrate}k`,
                '-ac', `${configuration.audioCodec.audioChannels}`,
            // '-vcodec', 'copy',
            '-f', 'mp4',
            '-force_key_frames', `expr:gte(t,n_forced*${iframeIntervalSeconds})`,
            '-movflags', 'frag_keyframe+empty_moov',
            '-vf', 'scale=1920:1080',
            `tcp://127.0.0.1:${serverPort}`
        );

        // args.push(
        //     '-acodec', 'copy',
        //     '-vcodec', 'copy',
        //     '-f', 'mp4',
        //     '-movflags', 'frag_keyframe+empty_moov',
        //     `tcp://127.0.0.1:${serverPort}`
        // );
        const cp = child_process.spawn('ffmpeg', args, {
            stdio: 'ignore',
        });
        console.log('homekit motion request');
    });

    const { socket, cp } = session;

    let pending: Buffer[] = [];
    try {
        while (true) {
            const header = await readLength(socket, 8);
            const length = header.readInt32BE() - 8;
            const type = header.slice(4).toString();
            const data = await readLength(socket, length);

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
        console.error('recording error', e);
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
    getAccessory(device: ScryptedDevice & VideoCamera & Camera & MotionSensor) {
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
            session.cp.kill();
            session.videoReturn.close();
            session.audioReturn.close();
        }

        const delegate: CameraStreamingDelegate = {
            async handleSnapshotRequest(request: SnapshotRequest, callback: SnapshotRequestCallback) {
                try {
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

                const session: Session = {
                    request,
                    videossrc,
                    audiossrc,
                    cp: null,
                    videoReturn: await getPort(),
                    audioReturn: await getPort(),
                }
                sessions.set(request.sessionID, session);

                // const addressOverride = (Object.entries(os.networkInterfaces()).filter(([iface, entry]) => iface.startsWith('en') || iface.startsWith('wlan')) as any)
                // .flat().map(([iface, entry]) => entry).find(i => i.family == 'IPv4').address;

                const response: PrepareStreamResponse = {
                    // addressOverride,
                    video: {
                        srtp_key: request.video.srtp_key,
                        srtp_salt: request.video.srtp_salt,
                        port: session.videoReturn.address().port,
                        ssrc: videossrc,
                    },
                    audio: {
                        srtp_key: request.audio.srtp_key,
                        srtp_salt: request.audio.srtp_salt,
                        port: session.audioReturn.address().port,
                        ssrc: audiossrc,
                    }
                }
                callback(null, response);
            },
            async handleStreamRequest(request: StreamingRequest, callback: StreamRequestCallback) {
                console.log(request);
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
                }

                session.videoReturn.on('data', () => debounce(() => {
                    controller.forceStopStreamingSession(request.sessionID);
                    killSession(request.sessionID);
                }, 60000));

                try {
                    const media = await device.getVideoStream();
                    const ffmpegInput = JSON.parse((await mediaManager.convertMediaObjectToBuffer(media, ScryptedMimeTypes.FFmpegInput)).toString()) as FFMpegInput;

                    const videoKey = Buffer.concat([session.request.video.srtp_key, session.request.video.srtp_salt]);
                    const audioKey = Buffer.concat([session.request.audio.srtp_key, session.request.audio.srtp_salt]);
                    const args: string[] = [];
                    args.push(...ffmpegInput.inputArguments);
                    args.push(
                        "-an", '-sn', '-dn',
                        "-vcodec", "copy",
                        '-pix_fmt', 'yuv420p',
                        '-color_range', 'mpeg',
                        "-f", "rawvideo",

                        "-b:v", "132k",
                        "-bufsize", "132k",
                        "-maxrate", "132k",
                        "-payload_type", (request as StartStreamRequest).video.pt.toString(),
                        "-ssrc", session.videossrc.toString(),
                        "-f", "rtp",
                        "-srtp_out_suite", session.request.video.srtpCryptoSuite === SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80 ?
                        "AES_CM_128_HMAC_SHA1_80" : "AES_CM_256_HMAC_SHA1_80",
                        "-srtp_out_params", videoKey.toString('base64'),
                        `srtp://${session.request.targetAddress}:${session.request.video.port}?rtcpport=${session.request.video.port}&pkt_size=1316`
                    )

                    const codec = (request as StartStreamRequest).audio.codec;
                    if (codec === AudioStreamingCodecType.OPUS || codec === AudioStreamingCodecType.AAC_ELD) {
                        console.log('acodec', codec);
                        args.push(
                            "-vn", '-sn', '-dn',
                            '-acodec', ...(codec === AudioStreamingCodecType.OPUS ?
                                ['libopus', '-application', 'lowdelay'] :
                                ['libfdk_aac', '-profile:a', 'aac_eld']),
                            '-flags', '+global_header',
                            '-f', 'null',
                            '-ar', `${(request as StartStreamRequest).audio.sample_rate}k`,
                            '-b:a', `${(request as StartStreamRequest).audio.max_bit_rate}k`,
                            '-ac', `${(request as StartStreamRequest).audio.channel}`,
                            "-payload_type",
                            (request as StartStreamRequest).audio.pt.toString(),
                            "-ssrc", session.audiossrc.toString(),
                            "-f", "rtp",
                            "-srtp_out_suite", session.request.audio.srtpCryptoSuite === SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80 ?
                            "AES_CM_128_HMAC_SHA1_80" : "AES_CM_256_HMAC_SHA1_80",
                            "-srtp_out_params", audioKey.toString('base64'),
                            `srtp://${session.request.targetAddress}:${session.request.audio.port}?rtcpport=${session.request.audio.port}&pkt_size=188`
                        )
                    }
                    else {
                        console.warn('unknown audio codec', request);
                    }

                    console.log(args);

                    const cp = child_process.spawn('ffmpeg', args, {
                        // stdio: 'ignore',
                    });
                    cp.stdout.on('data', data => console.log(data.toString()));
                    cp.stderr.on('data', data => console.error(data.toString()));

                    session.cp = cp;

                    callback();
                }
                catch (e) {
                    callback(e);
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

        if (device.interfaces.includes(ScryptedInterface.MotionSensor)) {
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
                        levels: [H264Level.LEVEL4_0],
                        profiles: [H264Profile.HIGH],
                    },
                    resolutions: [
                        // [1920, 1080, 15],
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
            recordingOptions,
            recordingDelegate,
        });

        accessory.configureController(controller);

        if (controller.motionService) {
            const service = controller.motionService;
            service.getCharacteristic(Characteristic.MotionDetected)
                .on(CharacteristicEventTypes.GET, (callback: NodeCallback<CharacteristicValue>) => {
                    callback(null, !!device.motionDetected);
                });

            listenCharacteristic(device, ScryptedInterface.MotionSensor, service, Characteristic.MotionDetected, true);
        }
        else {
            // maybeAddMotionSensor(device, accessory);
        }

        return accessory;
    }
});
