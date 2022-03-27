import { MediaStreamTrack, RTCIceCandidate, RTCPeerConnection, RTCRtpCodecParameters } from "@koush/werift";
import { Settings, RTCSignalingChannel, ScryptedDeviceType, ScryptedInterface, VideoCamera, Setting, SettingValue, RTCSessionControl, RTCSignalingClientOptions, RTCSignalingSession, FFMpegInput, ScryptedMimeTypes, RTCAVSignalingSetup, Intercom, RTCSignalingSendIceCandidate } from '@scrypted/sdk';
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

const { mediaManager, systemManager } = sdk;

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

class ScryptedSessionControl implements RTCSessionControl {
    constructor(public cleanup: () => Promise<void>) {
    }

    async getRefreshAt() {
    }
    async extendSession() {
    }
    async endSession() {
        await this.cleanup();
    }
}

class ScryptedSignalingSession implements RTCSignalingSession {
    constructor(public pc: RTCPeerConnection) {
    }

    async createLocalDescription(type: "offer" | "answer", setup: RTCAVSignalingSetup, sendIceCandidate: RTCSignalingSendIceCandidate): Promise<RTCSessionDescriptionInit> {
        this.pc.onIceCandidate.subscribe(candidate => {
            console.log('local candidate', candidate);
            sendIceCandidate({
                candidate: candidate.candidate,
                sdpMid: candidate.sdpMid,
                sdpMLineIndex: candidate.sdpMLineIndex,
            });
        })


        let ret: RTCSessionDescriptionInit;
        if (type === 'offer') {
            const offer = await this.pc.createOffer();
            await this.pc.setLocalDescription(offer);
            ret = {
                type: offer.type,
                sdp: offer.sdp,
            };
        }
        else {
            const answer = await this.pc.createAnswer();
            this.pc.setLocalDescription(answer);
            ret = {
                type: answer.type,
                sdp: answer.sdp,
            };
        }
        return ret;
    }

    async setRemoteDescription(description: RTCSessionDescriptionInit, setup: RTCAVSignalingSetup) {
        await this.pc.setRemoteDescription(description as any)
    }

    async addIceCandidate(candidate: RTCIceCandidateInit) {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
}

class WebRTCMixin extends SettingsMixinDeviceBase<VideoCamera & RTCSignalingChannel & Intercom> implements RTCSignalingChannel {
    storageSettings = new StorageSettings(this, {
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
                'Disabled',
                'Enabled',
                // 'Remote Only',
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
        }
    });

    constructor(options: SettingsMixinDeviceOptions<RTCSignalingChannel & Settings & VideoCamera & Intercom>) {
        super(options);
        this.storageSettings.options = {
            hide: {
                decoderArguments: async () => {
                    return this.storageSettings.values.transcode === 'Disabled';
                },
                encoderArguments: async () => {
                    return this.storageSettings.values.transcode === 'Disabled';
                }
            }
        };
    }

    async startRTCSignalingSession(session: RTCSignalingSession, options?: RTCSignalingClientOptions): Promise<RTCSessionControl> {
        // if the camera natively has RTCSignalingChannel and the client is not a weird non-browser
        // thing like Alexa, etc, pass through. Otherwise proxy/transcode.
        if (this.mixinDeviceInterfaces.includes(ScryptedInterface.RTCSignalingChannel) && !options?.proxy)
            return this.mixinDevice.startRTCSignalingSession(session, options);

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
        const rtspTcpServer = await listenZeroSingleClient();
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
                rtspServer.console = this.console;
                await rtspServer.handlePlayback();
                track.onReceiveRtp.subscribe(rtpPacket => {
                    rtpPacket.header.payloadType = 110;
                    rtspServer.sendAudio(rtpPacket.serialize(), false);
                })
            })
        }
        else {
            rtspTcpServer.clientPromise = Promise.reject(new Error('no intercom'));
        }

        const videoInput = await createBindZero();
        const audioInput = await createBindZero();

        videoInput.server.on('message', data => {
            vtrack.writeRtp(data);
        });

        audioInput.server.on('message', data => {
            atrack.writeRtp(data);
        });

        const cpPromise: Promise<ChildProcess> = new Promise(resolve => {
            let connected = false;
            pc.connectionStateChange.subscribe(async () => {
                if (connected)
                    return;

                if (pc.connectionState !== 'connected')
                    return;

                connected = true;

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
                const transcode = !sessionSupportsH264High || mediaStreamOptions?.video?.codec !== 'h264' || this.storageSettings.values.transcode === 'Enabled';
                if (transcode) {
                    const encoderArguments: string = this.storageSettings.values.encoderArguments;
                    if (!encoderArguments) {
                        videoArgs.push(
                            '-vcodec', 'libx264',
                            '-preset', 'ultrafast',
                            '-tune', 'zerolatency',
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
                    )
                }
                else {
                    videoArgs.push('-vcodec', 'copy')
                }

                if (this.storageSettings.values.addExtraData)
                    videoArgs.push("-bsf:v", "dump_extra");

                const decoderArguments: string[] = this.storageSettings.values.decoderArguments?.split(' ') || [];

                const args = [
                    '-hide_banner',

                    '-fflags', 'nobuffer',
                    '-flags', 'low_delay',

                    ...(transcode ? decoderArguments : []),

                    ...ffInput.inputArguments,

                    '-an',

                    ...videoArgs,

                    '-pkt_size', '1300',
                    '-fflags', '+flush_packets', '-flush_packets', '1',
                    '-f', 'rtp', `rtp://127.0.0.1:${videoInput.port}`,

                    '-vn',
                    '-acodec', 'libopus',
                    '-ar', '48k',
                    // choose a better birate? this is on the high end recommendation for voice.
                    '-b:a', '40k',
                    '-ac', '1',
                    '-application', 'lowdelay',
                    '-frame_duration', '60',
                    // '-pkt_size', '1300',
                    '-fflags', '+flush_packets', '-flush_packets', '1',
                    '-f', 'rtp', `rtp://127.0.0.1:${audioInput.port}`,
                ];

                safePrintFFmpegArguments(this.console, args);

                const cp = child_process.spawn(await mediaManager.getFFmpegPath(), args);
                ffmpegLogInitialOutput(this.console, cp);
                cp.on('exit', cleanup);
                resolve(cp);
            });
        });

        const cleanup = async () => {
            // no need to explicitly stop intercom as the server closing will terminate it.
            // do this to prevent shared intercom clobbering.
            closeQuiet(videoInput.server);
            closeQuiet(audioInput.server);
            closeQuiet(audioOutput.server);
            closeQuiet(rtspTcpServer.server);
            await Promise.allSettled([
                rtspTcpServer.clientPromise.then(client => client.destroy()),
                pc.close(),
                (async () => {
                    safeKillFFmpeg(await cpPromise);
                })(),
            ])
        };

        const isPeerConnectionAlive = () => {
            if (pc.iceConnectionState === 'disconnected'
                || pc.iceConnectionState === 'failed'
                || pc.iceConnectionState === 'closed')
                return false;
            if (pc.connectionState === 'closed'
                || pc.connectionState === 'disconnected'
                || pc.connectionState === 'failed')
                return false;
            return true;
        }

        pc.connectionStateChange.subscribe(() => {
            this.console.log('connectionStateChange', pc.connectionState);
            if (!isPeerConnectionAlive())
                cleanup();
        });
        pc.iceConnectionStateChange.subscribe(() => {
            this.console.log('iceConnectionStateChange', pc.iceConnectionState);
            if (!isPeerConnectionAlive())
                cleanup();
        });

        const answerSession = new ScryptedSignalingSession(pc);

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
}

class WebRTCSinkPlugin extends AutoenableMixinProvider {
    constructor() {
        super();
        this.on = this.on || false;
    }
    async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
        if (!supportedTypes.includes(type))
            return;

        if (!interfaces.includes(ScryptedInterface.VideoCamera))
            return;

        return [
            '@scrypted/webrtc-sink',
            ScryptedInterface.RTCSignalingChannel,
            ScryptedInterface.Settings,
        ];
    }

    async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any; }): Promise<any> {
        return new WebRTCMixin({
            mixinDevice,
            mixinDeviceInterfaces,
            mixinDeviceState,
            group: 'WebRTC',
            groupKey: 'webrtc-sink',
            mixinProviderNativeId: this.nativeId,
        })
    }

    async releaseMixin(id: string, mixinDevice: any): Promise<void> {
        await mixinDevice.release();
    }
}

export default new WebRTCSinkPlugin();
