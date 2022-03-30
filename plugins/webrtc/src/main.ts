import { MediaStreamTrack, RTCPeerConnection, RTCRtpCodecParameters } from "@koush/werift";
import { Settings, RTCSignalingChannel, ScryptedDeviceType, ScryptedInterface, VideoCamera, Setting, SettingValue, RTCSessionControl, RTCSignalingSession, FFMpegInput, ScryptedMimeTypes, RTCAVSignalingSetup, Intercom, RequestMediaStreamOptions, MediaObject, MediaStreamOptions, DeviceCreator, DeviceProvider, DeviceCreatorSettings, RTCSignalingOptions } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import { AutoenableMixinProvider } from '@scrypted/common/src/autoenable-mixin-provider';
import { ffmpegLogInitialOutput, safeKillFFmpeg, safePrintFFmpegArguments } from '@scrypted/common/src/media-helpers';
import { SettingsMixinDeviceBase, SettingsMixinDeviceOptions } from '@scrypted/common/src/settings-mixin';
import { StorageSettings } from '@scrypted/common/src/settings';
import { connectRTCSignalingClients } from '@scrypted/common/src/rtc-signaling';
import { closeQuiet, createBindZero, listenZeroSingleClient } from '@scrypted/common/src/listen-cluster';
import { getH264DecoderArgs, getH264EncoderArgs } from '@scrypted/common/src/ffmpeg-hardware-acceleration';
import { RtspServer } from '@scrypted/common/src/rtsp-server';
import { createSdpInput } from '@scrypted/common/src/sdp-utils';
import child_process, { ChildProcess } from 'child_process';
import { createRTCPeerConnectionSource, getRTCMediaStreamOptions } from './wrtc-to-rtsp';
import { WebRTCOutputSignalingSession } from "./output-signaling-session";
import { ScryptedSessionControl } from "./session-control";
import crypto from 'crypto';
import { WebRTCCamera } from "./webrtc-camera";
import ip from 'ip';
import { createTrackForwarders, getFFmpegRtpAudioOutputArguments, startRtpForwarderProcess } from "./rtp-forwarders";
import { isPeerConnectionAlive } from "./werift-util";

const { mediaManager, systemManager, deviceManager } = sdk;

const supportedTypes = [
    ScryptedDeviceType.Camera,
    ScryptedDeviceType.Doorbell,
];


function createSetup(type: 'offer' | 'answer', audioDirection: RTCRtpTransceiverDirection, videoDirection: RTCRtpTransceiverDirection): RTCAVSignalingSetup {
    return {
        type,
        audio: {
            direction: audioDirection,
        },
        video: {
            direction: videoDirection,
        },
    }
};


class WebRTCMixin extends SettingsMixinDeviceBase<VideoCamera & RTCSignalingChannel & Intercom> implements RTCSignalingChannel, VideoCamera, Intercom {
    storageSettings = new StorageSettings(this, {
        useUdp: {
            title: 'Use SDP/UDP instead of RTSP/TCP',
            description: 'Experimental',
            type: 'boolean',
            defaultValue: true,
            hide: true,
        },
        addExtraData: {
            title: 'Add H264 Extra Data',
            description: 'Some cameras do not include H264 extra data in the stream and this causes live streaming to always fail (but recordings may be working). This is a inexpensive video filter and does not perform a transcode. Enable this setting only as necessary.',
            type: 'boolean',
        },
        transcode: {
            title: 'Transcode Streaming',
            defaultValue: 'Default',
            choices: [
                'Default',
                'Always',
            ],
        },
        decoderArguments: {
            title: 'Video Decoder Arguments',
            placeholder: '-hwaccel auto',
            description: 'FFmpeg arguments used to decode input video.',
            combobox: true,
            choices: Object.keys(getH264DecoderArgs()),
            mapPut(oldValue, newValue) {
                return getH264DecoderArgs()[newValue]?.join(' ') || newValue;
            },
        },
        encoderArguments: {
            title: 'H264 Encoder Arguments',
            description: 'FFmpeg arguments used to encode h264 video.',
            combobox: true,
            choices: Object.keys(getH264EncoderArgs()),
            mapPut(oldValue, newValue) {
                return getH264EncoderArgs()[newValue]?.join(' ') || newValue;
            }
        },
        bitrate: {
            title: 'Bitrate',
            description: 'The bitrate to send when transcoding video.',
            type: 'number',
            defaultValue: 500000,
        },
    });

    constructor(options: SettingsMixinDeviceOptions<RTCSignalingChannel & Settings & VideoCamera & Intercom>) {
        super(options);
        // this.storageSettings.options = {
        //     hide: {
        //         decoderArguments: async () => {
        //             return this.storageSettings.values.transcode === 'Disabled';
        //         },
        //         encoderArguments: async () => {
        //             return this.storageSettings.values.transcode === 'Disabled';
        //         }
        //     }
        // };
    }

    startIntercom(media: MediaObject): Promise<void> {
        throw new Error("Method not implemented.");
    }
    stopIntercom(): Promise<void> {
        throw new Error("Method not implemented.");
    }

    async startRTCSignalingSession(session: RTCSignalingSession): Promise<RTCSessionControl> {
        // if the camera natively has RTCSignalingChannel and the client is not a weird non-browser
        // thing like Alexa, etc, pass through. Otherwise proxy/transcode.

        // but, maybe we should always proxy?

        const options = await session.getOptions();
        if (this.mixinDeviceInterfaces.includes(ScryptedInterface.RTCSignalingChannel) && !options?.proxy)
            return this.mixinDevice.startRTCSignalingSession(session);

        const hasIntercom = this.mixinDeviceInterfaces.includes(ScryptedInterface.Intercom);

        const offerAudioDirection = hasIntercom
            ? 'sendrecv'
            : 'recvonly';

        const answerAudioDirection = hasIntercom
            ? 'sendrecv'
            : 'sendonly';

        const device = systemManager.getDeviceById<VideoCamera>(this.id);
        const mo = await device.getVideoStream();
        const ffInput = await mediaManager.convertMediaObjectToJSON<FFMpegInput>(mo, ScryptedMimeTypes.FFmpegInput);
        const { mediaStreamOptions } = ffInput;

        const codec = new RTCRtpCodecParameters({
            mimeType: "video/H264",
            clockRate: 90000,
        });

        const pc = new RTCPeerConnection({
            codecs: {
                video: [
                    codec,
                ],
                audio: [
                    new RTCRtpCodecParameters({
                        mimeType: "audio/opus",
                        clockRate: 48000,
                        channels: 1,
                    })
                ],
            }
        });

        const vtrack = new MediaStreamTrack({
            kind: "video", codec,
        });
        const videoTransceiver = pc.addTransceiver(vtrack, {
            direction: 'sendonly',
        });

        const atrack = new MediaStreamTrack({ kind: "audio" });
        const audioTransceiver = pc.addTransceiver(atrack, {
            direction: answerAudioDirection,
        });

        const audioOutput = await createBindZero();
        const rtspTcpServer = hasIntercom ? await listenZeroSingleClient() : undefined;

        if (hasIntercom) {
            const sdpReturnAudio = [
                "v=0",
                "o=- 0 0 IN IP4 127.0.0.1",
                "s=" + "WebRTC Audio Talkback",
                "c=IN IP4 127.0.0.1",
                "t=0 0",
                "m=audio 0 RTP/AVP 110",
                "b=AS:24",
                "a=rtpmap:110 opus/48000/1",
                "a=fmtp:101 minptime=10;useinbandfec=1",
            ];
            let sdp = sdpReturnAudio.join('\r\n');
            sdp = createSdpInput(audioOutput.port, 0, sdp);

            audioTransceiver.onTrack.subscribe(async (track) => {
                const url = rtspTcpServer.url.replace('tcp:', 'rtsp:');
                const ffmpegInput: FFMpegInput = {
                    url,
                    inputArguments: [
                        '-rtsp_transport', 'udp',
                        '-i', url,
                    ],
                };
                const mo = await mediaManager.createFFmpegMediaObject(ffmpegInput);
                this.mixinDevice.startIntercom(mo);

                const client = await rtspTcpServer.clientPromise;

                const rtspServer = new RtspServer(client, sdp, audioOutput.server);
                // rtspServer.console = this.console;
                await rtspServer.handlePlayback();
                track.onReceiveRtp.subscribe(rtpPacket => {
                    rtpPacket.header.payloadType = 110;
                    rtspServer.sendAudio(rtpPacket.serialize(), false);
                })
            })
        }

        const cpPromise: Promise<ChildProcess> = new Promise(resolve => {
            let connected = false;
            pc.connectionStateChange.subscribe(async () => {
                if (connected)
                    return;

                if (pc.connectionState !== 'connected')
                    return;

                connected = true;

                let isPrivate = true;
                for (const ice of pc.validIceTransports()) {
                    const [address, port] = ice.connection.remoteAddr;
                    isPrivate = isPrivate && ip.isPrivate(address);
                }

                this.console.log('Connection is local network:', isPrivate);

                // we assume that the camera doesn't output h264 baseline, because
                // that is awful quality. so check to see if the session has an
                // explicit list of supported codecs with h264 high on it.
                const sessionSupportsH264High = options?.capabilities?.video?.codecs
                    ?.filter(codec => codec.mimeType.toLowerCase() === 'video/h264')
                    // 42 is baseline profile
                    // 64 is high profile
                    // not sure what main profile is, dunno if anything actually uses it.
                    ?.find(codec => codec.sdpFmtpLine.includes('profile-level-id=64'))

                const videoArgs: string[] = [];
                const transcode = !sessionSupportsH264High
                    || mediaStreamOptions?.video?.codec !== 'h264'
                    || this.storageSettings.values.transcode === 'Always';
                if (transcode) {
                    const encoderArguments: string = this.storageSettings.values.encoderArguments;
                    if (!encoderArguments) {
                        videoArgs.push(
                            '-vcodec', 'libx264',
                            '-preset', 'ultrafast',
                            // this causes chromecast to chop and show frames only every 10 seconds.
                            // but it seems to work fine everywhere else?
                            // '-tune', 'zerolatency',
                        );
                    }
                    else {
                        videoArgs.push(...encoderArguments.split(' '))
                    }

                    videoArgs.push(
                        "-bf", "0",
                        '-r', '15',
                        '-vf', 'scale=w=iw/2:h=ih/2',
                        '-profile:v', 'baseline',
                        // this seems to cause issues with presets i think.
                        // '-level:v', '4.0',
                        '-b:v', this.storageSettings.values.bitrate.toString(),
                        '-maxrate', this.storageSettings.values.bitrate.toString(),
                        '-bufsize', (this.storageSettings.values.bitrate / 2).toString(),
                    )
                }
                else {
                    videoArgs.push('-vcodec', 'copy')
                }

                if (this.storageSettings.values.addExtraData)
                    videoArgs.push("-bsf:v", "dump_extra");

                const decoderArguments: string[] = this.storageSettings.values.decoderArguments?.split(' ') || [];

                const { cp } = await startRtpForwarderProcess(this.console, [
                    ...(transcode ? decoderArguments : []),

                    ...ffInput.inputArguments,
                ], {
                    video: {
                        transceiver: videoTransceiver,
                        outputArguments: [
                            '-an',
                            ...videoArgs,
                            '-pkt_size', '1300',
                            '-fflags', '+flush_packets', '-flush_packets', '1',
                        ]
                    },
                    audio: {
                        transceiver: audioTransceiver,
                        outputArguments: [
                            ...getFFmpegRtpAudioOutputArguments(),
                        ]
                    }
                })

                cp.on('exit', cleanup);
                resolve(cp);
            });
        });

        const cleanup = async () => {
            // no need to explicitly stop intercom as the server closing will terminate it.
            // do this to prevent shared intercom clobbering.
            closeQuiet(audioOutput.server);
            closeQuiet(rtspTcpServer?.server);
            await Promise.allSettled([
                rtspTcpServer?.clientPromise.then(client => client.destroy()),
                pc.close(),
                (async () => {
                    safeKillFFmpeg(await cpPromise);
                })(),
            ])
        };

        pc.connectionStateChange.subscribe(() => {
            this.console.log('connectionStateChange', pc.connectionState);
            if (!isPeerConnectionAlive(pc))
                cleanup();
        });
        pc.iceConnectionStateChange.subscribe(() => {
            this.console.log('iceConnectionStateChange', pc.iceConnectionState);
            if (!isPeerConnectionAlive(pc))
                cleanup();
        });

        const answerSession = new WebRTCOutputSignalingSession(pc);

        connectRTCSignalingClients(session, createSetup('offer', offerAudioDirection, 'recvonly'),
            answerSession, createSetup('answer', answerAudioDirection, 'sendonly'), !!options?.offer);

        return new ScryptedSessionControl(cleanup);
    }

    getMixinSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }

    putMixinSetting(key: string, value: SettingValue): Promise<void> {
        return this.storageSettings.putSetting(key, value);
    }


    createVideoStreamOptions() {
        const ret = getRTCMediaStreamOptions('webrtc', 'WebRTC', this.storageSettings.values.useUdp);
        ret.source = 'cloud';
        return ret;
    }

    async getVideoStream(options?: RequestMediaStreamOptions): Promise<MediaObject> {
        if (this.mixinDeviceInterfaces.includes(ScryptedInterface.VideoCamera) && options?.id !== 'webrtc') {
            return this.mixinDevice.getVideoStream(options);
        }

        const { ffmpegInput } = await createRTCPeerConnectionSource({
            console: this.console,
            mediaStreamOptions: this.createVideoStreamOptions(),
            channel: this.mixinDevice,
            useUdp: this.storageSettings.values.useUdp,
        });

        return mediaManager.createFFmpegMediaObject(ffmpegInput);
    }

    async getVideoStreamOptions(): Promise<MediaStreamOptions[]> {
        let ret: MediaStreamOptions[] = [];
        if (this.mixinDeviceInterfaces.includes(ScryptedInterface.VideoCamera)) {
            ret = await this.mixinDevice.getVideoStreamOptions();
        }
        ret.push(this.createVideoStreamOptions());
        return ret;
    }

}

class WebRTCPlugin extends AutoenableMixinProvider implements DeviceCreator, DeviceProvider {
    constructor() {
        super();
        this.unshiftMixin = true;
    }

    async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
        // if this is a webrtc camera, also proxy the signaling channel too
        // for inflexible clients.
        if (interfaces.includes(ScryptedInterface.RTCSignalingChannel)) {
            const ret = [
                ScryptedInterface.RTCSignalingChannel,
            ];
            if (type === ScryptedDeviceType.Speaker) {
                ret.push(ScryptedInterface.Intercom);
            }
            else if (type === ScryptedDeviceType.SmartSpeaker) {
                ret.push(ScryptedInterface.Intercom, ScryptedInterface.Microphone);
            }
            else if (type === ScryptedDeviceType.Camera || type === ScryptedDeviceType.Doorbell) {
                ret.push(ScryptedInterface.VideoCamera, ScryptedInterface.Intercom);
            }
            else if (type === ScryptedDeviceType.Display) {
                // intercom too?
                ret.push(ScryptedInterface.Display);
            }
            else if (type === ScryptedDeviceType.SmartDisplay) {
                // intercom too?
                ret.push(ScryptedInterface.Display, ScryptedInterface.VideoCamera);
            }
            else {
                return;
            }

            return ret;
        }
        else if (supportedTypes.includes(type)) {
            return [
                ScryptedInterface.RTCSignalingChannel,
                ScryptedInterface.Settings,
            ];
        }
    }

    async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any; }): Promise<any> {
        return new WebRTCMixin({
            mixinDevice,
            mixinDeviceInterfaces,
            mixinDeviceState,
            group: 'WebRTC',
            groupKey: 'webrtc',
            mixinProviderNativeId: this.nativeId,
        })
    }

    async releaseMixin(id: string, mixinDevice: any): Promise<void> {
        await mixinDevice.release();
    }

    async getCreateDeviceSettings(): Promise<Setting[]> {
        return [
            {
                key: 'name',
                title: 'Name',
                description: 'The name of the browser connected camera.',
            }
        ];
    }

    async createDevice(settings: DeviceCreatorSettings): Promise<string> {
        const nativeId = crypto.randomBytes(8).toString('hex');
        await deviceManager.onDeviceDiscovered({
            name: settings.name?.toString(),
            type: ScryptedDeviceType.Camera,
            nativeId,
            interfaces: [
                ScryptedInterface.Display,
                ScryptedInterface.Intercom,
                // two way video?
                // ScryptedInterface.VideoCamera,

                // RTCSignalingChannel is actually implemented as a loopback from the browser, but
                // since the feed needs to be tee'd to multiple clients, use VideoCamera instead
                // to do that.
                // ScryptedInterface.RTCSignalingChannel,
                ScryptedInterface.RTCSignalingClient,
            ],
        });
        return nativeId;
    }

    getDevice(nativeId: string) {
        return new WebRTCCamera(nativeId);
    }
}

export default new WebRTCPlugin();
