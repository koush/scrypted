import { RtpPacket } from '@koush/werift-src/packages/rtp/src/rtp/rtp';
import { ProtectionProfileAes128CmHmacSha1_80 } from '@koush/werift-src/packages/rtp/src/srtp/const';
import { Config } from '@koush/werift-src/packages/rtp/src/srtp/session';
import { SrtcpSession } from '@koush/werift-src/packages/rtp/src/srtp/srtcp';
import { SrtpSession } from '@koush/werift-src/packages/rtp/src/srtp/srtp';
import { bindUdp, closeQuiet, listenZeroSingleClient } from '@scrypted/common/src/listen-cluster';
import { Deferred } from '@scrypted/common/src/deferred';
import { RtspServer } from '@scrypted/common/src/rtsp-server';
import { addTrackControls, getSpsPpsVps, parseSdp } from '@scrypted/common/src/sdp-utils';
import sdk, { FFmpegInput, Intercom, MediaStreamFeedback, ScryptedDevice, ScryptedInterface, ScryptedMimeTypes, VideoCamera } from '@scrypted/sdk';
import dgram from 'dgram';
import { Socket } from 'net';
import { RtpForwarderProcess, RtpTracks, startRtpForwarderProcess } from '../../../../webrtc/src/rtp-forwarders';
import { AudioStreamingSamplerate, CameraController, MultiTierPrepareStreamRequest, MultiTierRTPStreamingDelegate, RTPSRTPParameters, SecureVideoVideoTier } from '../../hap';
import { createCameraStreamSender } from './camera-streaming-srtp-sender';

const videoPayloadType = 99;
const audioPayloadType = 110;
// Leave room for the SRTP authentication tag inside a 1200-byte UDP payload.
const rtpPacketSize = 1190;

function srtpConfig(parameters: RTPSRTPParameters): Config {
    if (parameters.cryptoSuite !== 0 || parameters.masterKey.length !== 16 || parameters.masterSalt.length !== 14)
        throw new Error('Unsupported multi-tier SRTP parameters');
    return {
        profile: ProtectionProfileAes128CmHmacSha1_80,
        keys: {
            localMasterKey: parameters.masterKey,
            localMasterSalt: parameters.masterSalt,
            remoteMasterKey: parameters.masterKey,
            remoteMasterSalt: parameters.masterSalt,
        },
    };
}

interface Session {
    request: MultiTierPrepareStreamRequest;
    video: dgram.Socket;
    audio: dgram.Socket;
    videoConfig: Config;
    audioConfig: Config;
    videoSSRC: number;
    audioSSRC: number;
    generation: number;
    ended: Deferred<void>;
    timeout?: NodeJS.Timeout;
    forwarder?: RtpForwarderProcess;
    feedback?: MediaStreamFeedback;
    videoClock?: { start: number; base: number; sourceTimestamp: number; ticks: number };
    videoSenders: Map<number, ReturnType<typeof createCameraStreamSender>>;
    audioSenders: Map<number, ReturnType<typeof createCameraStreamSender>>;
    stopTalkback?: () => void;
    startingTalkback?: boolean;
    talkback?: { server: RtspServer, track: string };
}

export function createMultiTierRtpDelegate(device: ScryptedDevice & VideoCamera & Intercom, tiers: SecureVideoVideoTier[], console: Console, storage?: Storage) {
    const sessions = new Map<string, Session>();
    let intercomOwner: Session;

    function stop(session: Session) {
        if (session.ended.finished)
            return;
        session.ended.resolve();
        session.generation++;
        if (sessions.get(session.request.sessionIdentifier) === session)
            sessions.delete(session.request.sessionIdentifier);
        console.log('HSV3 RTP session stopped:', session.request.sessionIdentifier);
    }

    function refreshTimeout(session: Session) {
        if (session.ended.finished)
            return;
        clearTimeout(session.timeout);
        session.timeout = setTimeout(() => stop(session), 60000);
        session.timeout.unref();
    }

    async function startTalkback(session: Session) {
        if (intercomOwner && intercomOwner !== session)
            return;
        intercomOwner = session;
        session.startingTalkback = true;
        let listener: Awaited<ReturnType<typeof listenZeroSingleClient>>;
        let client: Socket;
        const ended = new Deferred<undefined>();
        let intercomStart: Promise<void>;
        let intercomStarting = false;
        const cleanup = () => { ended.resolve(undefined); };
        const stopIntercom = async () => {
            try {
                await device.stopIntercom();
            }
            catch (error) {
                console.error('HSV3 intercom stop failed', error);
            }
        };
        ended.promise.then(async () => {
            session.talkback = undefined;
            // Keep ownership until a pending start has settled and been stopped.
            // Otherwise a late start can outlive cleanup, or its stop can affect
            // a newer session's intercom.
            if (intercomOwner === session) {
                const pendingStart = intercomStarting;
                await stopIntercom();
                if (pendingStart) {
                    await intercomStart;
                    await stopIntercom();
                }
                intercomOwner = undefined;
            }
            session.startingTalkback = false;
            if (session.stopTalkback === cleanup)
                session.stopTalkback = undefined;
        }).catch(error => console.error('HSV3 talkback cleanup failed', error));
        session.stopTalkback = cleanup;
        try {
            listener = await listenZeroSingleClient('127.0.0.1', undefined, 10000);
            ended.promise.then(() => listener.cancel()).catch(error => console.error('HSV3 talkback listener cleanup failed', error));
            // Attach before any further await: even a connection accepted during
            // cancellation must be owned and destroyed.
            const clientPromise = listener.clientPromise.then(socket => {
                ended.promise.then(() => socket.destroy()).catch(error => console.error('HSV3 talkback client cleanup failed', error));
                socket.on('close', cleanup);
                socket.on('error', cleanup);
                return socket;
            });
            clientPromise.catch(error => {
                if (!session.ended.finished && !ended.finished)
                    console.error('HSV3 talkback connection failed', error);
                cleanup();
            });
            if (session.ended.finished || ended.finished) {
                cleanup();
                return;
            }
            const url = listener.url.replace('tcp:', 'rtsp:');
            const sdp = addTrackControls([
                'v=0', 'o=- 0 0 IN IP4 127.0.0.1', 's=HomeKit Talkback', 'c=IN IP4 127.0.0.1', 't=0 0',
                `m=audio 0 RTP/AVP ${audioPayloadType}`, `a=rtpmap:${audioPayloadType} opus/48000/2`,
                `a=fmtp:${audioPayloadType} minptime=20;useinbandfec=1;sprop-stereo=0`, '',
            ].join('\r\n'));
            const media = await sdk.mediaManager.createFFmpegMediaObject({
                url, inputArguments: ['-rtsp_transport', 'tcp', '-i', url],
            }, { sourceId: device.id });
            if (session.ended.finished || ended.finished) {
                cleanup();
                return;
            }
            intercomStarting = true;
            intercomStart = (async () => {
                try {
                    await device.startIntercom(media);
                }
                catch (error) {
                    console.error('HSV3 intercom start failed', error);
                    cleanup();
                }
                finally {
                    intercomStarting = false;
                }
            })();
            client = await Promise.race([clientPromise, ended.promise]);
            if (!client)
                return;
            if (session.ended.finished || ended.finished) {
                cleanup();
                return;
            }
            const server = new RtspServer(client, sdp);
            await server.handlePlayback();
            // service keepalive and teardown requests from the rtsp client.
            server.handleSetup(['teardown'])
                .catch(() => { });
            if (!session.ended.finished && !ended.finished)
                session.talkback = { server, track: parseSdp(sdp).msections[0].control };
        }
        catch (error) {
            if (!session.ended.finished && !ended.finished)
                console.error('HSV3 talkback failed', error);
            cleanup();
        }
    }

    const delegate: MultiTierRTPStreamingDelegate = {
        async prepareStream(request) {
            const videoConfig = srtpConfig(request.video);
            const audioConfig = srtpConfig(request.audio);
            const previous = sessions.get(request.sessionIdentifier);
            if (previous)
                stop(previous);
            if (sessions.size >= 16)
                throw new Error('Too many multi-tier RTP sessions');
            const type = request.addressVersion === 'ipv6' ? 'udp6' : 'udp4';
            const address = type === 'udp4' ? request.sourceAddress.replace(/^::ffff:/, '') : request.sourceAddress;
            const video = dgram.createSocket(type);
            const audio = dgram.createSocket(type);
            const session: Session = {
                request, video, audio, videoConfig, audioConfig,
                videoSSRC: CameraController.generateSynchronisationSource(),
                audioSSRC: CameraController.generateSynchronisationSource(),
                generation: 0, ended: new Deferred<void>(), videoSenders: new Map(), audioSenders: new Map(),
            };
            // Register cleanup before binding or starting asynchronous work. Each
            // resource is independent so a cleanup failure cannot skip the rest.
            session.ended.promise.then(() => clearTimeout(session.timeout));
            for (const socket of [video, audio])
                session.ended.promise.then(() => closeQuiet(socket));
            session.ended.promise.then(() => {
                const forwarder = session.forwarder;
                session.forwarder = undefined;
                session.feedback = undefined;
                session.videoSenders.clear();
                session.audioSenders.clear();
                forwarder?.kill();
            }).catch(error => console.error('HSV3 forwarder cleanup failed', error));
            session.ended.promise.then(() => session.stopTalkback?.())
                .catch(error => console.error('HSV3 talkback cleanup failed', error));
            sessions.set(request.sessionIdentifier, session);
            refreshTimeout(session);
            // Closing a socket during bind may suppress its listening event.
            // Ensure setup still settles when the session is cancelled.
            const cancelled = session.ended.promise.then(() => { throw new Error('RTP setup cancelled'); });
            try {
                const videoPort = (await Promise.race([bindUdp(video, 0, address), cancelled])).port;
                if (session.ended.finished)
                    throw new Error('RTP setup cancelled');
                const audioPort = (await Promise.race([bindUdp(audio, 0, address), cancelled])).port;
                if (session.ended.finished)
                    throw new Error('RTP setup cancelled');
                for (const socket of [video, audio]) {
                    socket.setSendBufferSize(1024 * 1024);
                    socket.on('error', error => {
                        console.error('HSV3 RTP socket failed', error);
                        stop(session);
                    });
                }
                const videoRtcp = new SrtcpSession(videoConfig);
                const audioRtcp = new SrtcpSession(audioConfig);
                const returnAudio = new SrtpSession(audioConfig);
                const receive = (data: Buffer, isVideo: boolean) => {
                    if (session.ended.finished || data.length < 12 || data[0] >> 6 !== 2)
                        return;
                    try {
                        const isRtcp = data[1] >= 192 && data[1] <= 223;
                        if (isRtcp) {
                            const rtcp = (isVideo ? videoRtcp : audioRtcp).decrypt(data);
                            refreshTimeout(session);
                            if (isVideo)
                                session.feedback?.onRtcp(rtcp);
                        }
                        else if (!isVideo && device.interfaces.includes(ScryptedInterface.Intercom)) {
                            const decrypted = returnAudio.decrypt(data);
                            if (RtpPacket.deSerialize(decrypted).header.payloadType !== audioPayloadType)
                                return;
                            if (session.talkback)
                                session.talkback.server.sendTrack(session.talkback.track, decrypted, false);
                            else if (!session.startingTalkback)
                                void startTalkback(session);
                        }
                    }
                    catch {
                        // Ignore malformed or unauthenticated return traffic.
                    }
                };
                video.on('message', data => receive(data, true));
                audio.on('message', data => receive(data, false));
                refreshTimeout(session);
                console.log('HSV3 RTP prepared:', request.sessionIdentifier, { address, videoPort, audioPort, targetAddress: request.targetAddress });
                return { addressOverride: address, videoPort, audioPort, videoSSRC: session.videoSSRC, audioSSRC: session.audioSSRC, video: request.video, audio: request.audio };
            }
            catch (error) {
                stop(session);
                throw error;
            }
        },
        async startStream(request) {
            const session = sessions.get(request.sessionIdentifier);
            if (!session || session.ended.finished)
                throw new Error('Unknown multi-tier RTP session');
            const tier = tiers.find(t => t.identifier === request.videoTier);
            if (!tier || (request.audioTier !== undefined && request.audioTier !== 1))
                throw new Error('Unknown multi-tier stream tier');
            if (session.forwarder) {
                refreshTimeout(session);
                await session.feedback?.reconfigureStream({
                    video: {
                        bitrate: tier.targetAverageBitrate * 1000,
                        width: tier.width,
                        height: tier.height,
                    },
                });
                return;
            }
            const generation = ++session.generation;
            const active = () => !session.ended.finished && session.generation === generation;
            session.forwarder?.kill();
            session.forwarder = undefined;
            session.feedback = undefined;
            refreshTimeout(session);
            try {
                console.log('HSV3 RTP starting:', request.sessionIdentifier, { tier: tier.identifier, width: tier.width, height: tier.height, fps: tier.frameRate });
                const media = await device.getVideoStream({
                    destination: 'local', destinationId: session.request.targetAddress, destinationType: '@scrypted/homekit',
                    container: 'rtsp', adaptive: true,
                    video: { codec: 'h265', bitrate: tier.targetAverageBitrate * 1000, clientWidth: tier.width, clientHeight: tier.height },
                    audio: request.audioTier === undefined ? null : { codec: 'opus' },
                });
                if (!active())
                    return;
                const input = await sdk.mediaManager.convertMediaObjectToJSON<FFmpegInput>(media, ScryptedMimeTypes.FFmpegInput);
                let feedback: MediaStreamFeedback;
                try {
                    feedback = await sdk.mediaManager.convertMediaObject(media, ScryptedMimeTypes.MediaStreamFeedback);
                }
                catch { }
                if (!active())
                    return;
                session.feedback = feedback;
                // iOS filters incoming media by the accessory SSRCs returned in
                // Setup Endpoints. START can carry different SSRCs; retain the
                // prepared SSRCs for outgoing RTP/RTCP.
                const videoSSRC = session.videoSSRC;
                const audioSSRC = session.audioSSRC;
                const ffmpegSender = storage?.getItem('rtpSender') === 'FFmpeg';
                const useSystemClock = storage?.getItem('secureVideo3UseSystemClock') !== 'false';
                const videoOptions = { codec: 'h265' as const, maxPacketSize: rtpPacketSize,
                    vps: undefined as Buffer, sps: undefined as Buffer, pps: undefined as Buffer };
                // Retain encryption/sequence state across tier changes that reuse an SSRC.
                let videoSender = session.videoSenders.get(videoSSRC);
                if (!ffmpegSender && !videoSender) {
                    videoSender = createCameraStreamSender(console, session.videoConfig, session.video, videoSSRC, videoPayloadType,
                        session.request.controllerVideoPort, session.request.targetAddress, 0.5, videoOptions, undefined, true);
                    session.videoSenders.set(videoSSRC, videoSender);
                }
                const tracks: RtpTracks = {
                    video: {
                        codecCopy: 'h265', payloadType: videoPayloadType, packetSize: rtpPacketSize,
                        // Only used by the forwarder if the source requires transcoding.
                        encoderArguments: ['-c:v', 'libx265', '-preset', 'ultrafast', '-tune', 'zerolatency',
                            '-pix_fmt', 'yuv420p', '-b:v', `${tier.targetAverageBitrate}k`, '-maxrate', `${tier.peakBitrate}k`,
                            '-bufsize', `${tier.peakBitrate * 2}k`, '-r', `${tier.frameRate}`, '-g', `${tier.frameRate * 2}`],
                        onMSection: section => { Object.assign(videoOptions, getSpsPpsVps(section)); },
                        onRtp: buffer => {
                            if (!active())
                                return;
                            try {
                                const rtp = RtpPacket.deSerialize(buffer);
                                // Camera-specific extensions/CSRCs are not negotiated with HomeKit.
                                rtp.header.extension = false;
                                rtp.header.extensions = [];
                                rtp.header.csrc = [];
                                rtp.header.csrcLength = 0;
                                if (useSystemClock) {
                                    const sourceTimestamp = rtp.header.timestamp;
                                    const now = performance.now();
                                    const clock = session.videoClock ??= {
                                        start: now, base: sourceTimestamp, sourceTimestamp, ticks: 0,
                                    };
                                    if (sourceTimestamp !== clock.sourceTimestamp) {
                                        // Keep pictures distinct during catch-up bursts, but share
                                        // one timestamp across every slice/fragment of a picture.
                                        clock.ticks = Math.max(clock.ticks + 1, Math.round((now - clock.start) * 90));
                                        clock.sourceTimestamp = sourceTimestamp;
                                    }
                                    rtp.header.timestamp = (clock.base + clock.ticks) >>> 0;
                                }
                                videoSender.sendRtp(rtp);
                            }
                            catch (error) {
                                console.error('HSV3 H.265 packetization failed', error);
                                stop(session);
                            }
                        },
                    },
                };
                if (ffmpegSender) {
                    const video = tracks.video;
                    // Force the FFmpeg path even when the source is native HEVC.
                    video.codecCopy = 'transcode';
                    if (input.mediaStreamOptions?.video?.codec === 'h265')
                        video.encoderArguments = ['-c:v', 'copy', '-bsf:v', 'dump_extra'];
                    const address = session.request.addressVersion === 'ipv6'
                        ? `[${session.request.targetAddress}]` : session.request.targetAddress;
                    video.ffmpegDestination = `${address}:${session.request.controllerVideoPort}`;
                    video.rtcpPort = session.request.controllerVideoPort;
                    video.ssrc = videoSSRC;
                    video.srtp = {
                        crytoSuite: 'AES_CM_128_HMAC_SHA1_80',
                        key: Buffer.concat([session.videoConfig.keys.localMasterKey, session.videoConfig.keys.localMasterSalt]),
                    };
                    video.onMSection = undefined;
                    video.onRtp = () => {};
                }
                if (request.audioTier !== undefined && input.mediaStreamOptions?.audio !== null) {
                    let audioSender = session.audioSenders.get(audioSSRC);
                    if (!audioSender) {
                        audioSender = createCameraStreamSender(console, session.audioConfig, session.audio, audioSSRC, audioPayloadType,
                            session.request.controllerAudioPort, session.request.targetAddress, 0.5, undefined,
                            { audioPacketTime: 20, audioSampleRate: AudioStreamingSamplerate.KHZ_16, framesPerPacket: 1, rtpClockRate: 48000 }, true);
                        session.audioSenders.set(audioSSRC, audioSender);
                    }
                    tracks.audio = {
                        codecCopy: 'opus', payloadType: audioPayloadType, packetSize: 400,
                        encoderArguments: ['-c:a', 'libopus', '-application', 'lowdelay', '-frame_duration', '20', '-ar', '16000', '-b:a', '24k', '-ac', '1'],
                        onRtp: buffer => {
                            if (!active())
                                return;
                            try { audioSender.sendRtp(RtpPacket.deSerialize(buffer)); }
                            catch (error) {
                                console.error('HSV3 Opus packetization failed', error);
                                stop(session);
                            }
                        },
                    };
                }
                const forwarder = await startRtpForwarderProcess(console, input, tracks);
                forwarder.killPromise.then(() => {
                    if (active())
                        stop(session);
                }, error => {
                    if (!active())
                        return;
                    console.error('HSV3 RTP forwarder failed', error);
                    stop(session);
                });
                if (!active()) {
                    forwarder.kill();
                    return;
                }
                session.forwarder = forwarder;
            }
            catch (error) {
                if (active())
                    stop(session);
                console.error('HSV3 RTP start failed', error);
                throw error;
            }
        },
        async stopStream(id) {
            const session = sessions.get(id);
            if (session)
                stop(session);
        },
    };
    return { ...delegate, stopAll: () => { for (const session of sessions.values()) stop(session); } };
}
