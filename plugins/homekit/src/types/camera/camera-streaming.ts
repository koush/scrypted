import type { RtcpRrPacket } from '@koush/werift-src/packages/rtp/src/rtcp/rr';
import { RtcpPacketConverter } from '@koush/werift-src/packages/rtp/src/rtcp/rtcp';
import { RtpPacket } from '@koush/werift-src/packages/rtp/src/rtp/rtp';
import { ProtectionProfileAes128CmHmacSha1_80 } from '@koush/werift-src/packages/rtp/src/srtp/const';
import { SrtcpSession } from '@koush/werift-src/packages/rtp/src/srtp/srtcp';
import { bindUdp, closeQuiet } from '@scrypted/common/src/listen-cluster';
import { timeoutPromise } from '@scrypted/common/src/promise-utils';
import sdk, { Camera, FFmpegInput, Intercom, MediaStreamOptions, RequestMediaStreamOptions, ScryptedDevice, ScryptedInterface, ScryptedMimeTypes, VideoCamera, VideoCameraConfiguration } from '@scrypted/sdk';
import dgram, { SocketType } from 'dgram';
import { once } from 'events';
import os from 'os';
import { AudioStreamingCodecType, CameraController, CameraStreamingDelegate, PrepareStreamCallback, PrepareStreamRequest, PrepareStreamResponse, StartStreamRequest, StreamingRequest, StreamRequestCallback, StreamRequestTypes } from '../../hap';
import type { HomeKitPlugin } from "../../main";
import { startRtpSink } from '../../rtp/rtp-ffmpeg-input';
import { createSnapshotHandler } from '../camera/camera-snapshot';
import { DynamicBitrateSession } from './camera-dynamic-bitrate';
import { startCameraStreamFfmpeg } from './camera-streaming-ffmpeg';
import { CameraStreamingSession } from './camera-streaming-session';
import { getStreamingConfiguration } from './camera-utils';

const { mediaManager } = sdk;
const v4Regex = /^[\d]{1,3}\.[\d]{1,3}\.[\d]{1,3}\.[\d]{1,3}$/
const v4v6Regex = /^::ffff:[\d]{1,3}\.[\d]{1,3}\.[\d]{1,3}\.[\d]{1,3}$/;

async function getPort(socketType: SocketType, address: string): Promise<{ socket: dgram.Socket, port: number }> {
    const socket = dgram.createSocket(socketType);
    const { port } = await bindUdp(socket, 0, address);
    return { socket, port };
}

export function createCameraStreamingDelegate(device: ScryptedDevice & VideoCamera & VideoCameraConfiguration & Camera & Intercom,
    console: Console,
    storage: Storage,
    homekitPlugin: HomeKitPlugin) {
    const sessions = new Map<string, CameraStreamingSession>();
    const twoWayAudio = device.interfaces?.includes(ScryptedInterface.Intercom);

    const delegate: CameraStreamingDelegate = {
        handleSnapshotRequest: createSnapshotHandler(device, storage, homekitPlugin, console),
        async prepareStream(request: PrepareStreamRequest, callback: PrepareStreamCallback) {
            // console.log('prepareStream', Object.assign({}, request, { connection: request.connection.remoteAddress }));

            const { sessionID } = request;
            let killResolve: any;
            const streamingSessionStartTime = Date.now();
            const killPromise = new Promise<void>(resolve => {
                killResolve = () => {
                    resolve();

                    const session = sessions.get(sessionID);
                    if (!session)
                        return;
                    sessions.delete(sessionID);

                    console.log(`streaming session killed, duration: ${Math.round((Date.now() - streamingSessionStartTime) / 1000)}s`);
                    session.killed = true;
                }
            });

            const socketType = request.addressVersion === 'ipv6' ? 'udp6' : 'udp4';
            let addressOverride = homekitPlugin.storageSettings.values.addressOverride || undefined;

            if (addressOverride) {
                const infos = Object.values(os.networkInterfaces()).flat().map(i => i?.address);
                if (!infos.find(address => address === addressOverride)) {
                    console.error('The provided Scrypted Server Address was not found in the list of network addresses and may be invalid and will not be used (DHCP assignment change?): ' + addressOverride);
                    addressOverride = undefined;
                }
            }

            const { socket: videoReturn, port: videoPort } = await getPort(socketType, addressOverride);
            const { socket: audioReturn, port: audioPort } = await getPort(socketType, addressOverride);

            killPromise.finally(() => {
                closeQuiet(videoReturn);
                closeQuiet(audioReturn);
            });

            const videossrc = CameraController.generateSynchronisationSource();
            const audiossrc = CameraController.generateSynchronisationSource();

            const session: CameraStreamingSession = {
                aconfig: {
                    keys: {
                        localMasterKey: request.audio.srtp_key,
                        localMasterSalt: request.audio.srtp_salt,
                        remoteMasterKey: request.audio.srtp_key,
                        remoteMasterSalt: request.audio.srtp_salt,
                    },
                    profile: ProtectionProfileAes128CmHmacSha1_80,
                },
                vconfig: {
                    keys: {
                        localMasterKey: request.video.srtp_key,
                        localMasterSalt: request.video.srtp_salt,
                        remoteMasterKey: request.video.srtp_key,
                        remoteMasterSalt: request.video.srtp_salt,
                    },
                    profile: ProtectionProfileAes128CmHmacSha1_80,
                },
                kill: killResolve,
                killPromise,
                killed: false,
                prepareRequest: request,
                startRequest: null,
                videossrc,
                audiossrc,
                videoReturn,
                audioReturn,
                videoReturnRtcpReady: undefined,
            };

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

            console.log('destination address', session.prepareRequest.targetAddress, session.prepareRequest.video.port, session.prepareRequest.audio.port);
            // plugin scope or device scope?
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

            console.log('source address', response.addressOverride, videoPort, audioPort);
            // console.log('prepareStream response', response);

            callback(null, response);
        },
        async handleStreamRequest(request: StreamingRequest, callback: StreamRequestCallback) {
            console.log('handleStreamRequest', request);
            if (request.type === StreamRequestTypes.STOP) {
                sessions.get(request.sessionID)?.kill();
                callback();
                return;
            }

            const session = sessions.get(request.sessionID);

            if (!session) {
                callback(new Error('unknown session'));
                return;
            }

            callback();

            if (request.type === StreamRequestTypes.RECONFIGURE) {
                session.tryReconfigureBitrate?.('reconfigure', request.video.max_bit_rate * 1000);
                return;
            }

            session.startRequest = request as StartStreamRequest;

            let forceSlowConnection = false;
            try {
                for (const address of homekitPlugin.storageSettings.values.slowConnections) {
                    if (address.includes(session.prepareRequest.targetAddress))
                        forceSlowConnection = true;
                }
            }
            catch (e) {
            }
            if (forceSlowConnection) {
                console.log('Streaming request is coming from a device in the slow mode connection list. Medium resolution stream will be selected.');
            }
            else {
                // ios is seemingly forcing all connections through the home hub on ios 15.5. this is test code to force low bandwidth.
                // remote wifi connections request the same audio packet time as local wifi connections.
                // so there's no way to differentiate between remote and local wifi. with low bandwidth forcing off,
                // it will always select the local stream. with it on, it always selects the remote stream.
                forceSlowConnection = homekitPlugin.storageSettings.values.slowConnections?.includes(session.prepareRequest.targetAddress);
                if (forceSlowConnection)
                    console.log('Streaming request is coming from the active HomeHub. Medium resolution stream will be selected in case this is a remote wifi connection or a wireless HomeHub. Using Accessory Mode is recommended if not already in use.');
            }

            const {
                destination,
                dynamicBitrate,
                isLowBandwidth,
                isWatch,
            } = await getStreamingConfiguration(device, forceSlowConnection, storage, request)

            const hasHomeHub = !!homekitPlugin.storageSettings.values.lastKnownHomeHub;
            const waitRtcp = forceSlowConnection || isLowBandwidth || !hasHomeHub;
            if (waitRtcp) {
                console.log('Will wait for initial RTCP packet.', {
                    isHomeHub: forceSlowConnection,
                    isLowBandwidth,
                    hasHomeHub,
                });
            }

            const videoReturnRtcpReady = waitRtcp
                ? timeoutPromise(1000, once(session.videoReturn, 'message')).catch(() => {
                    console.warn('Video RTCP Packet timed out. There may be a network (routing/firewall) issue preventing the Apple device sending UDP packets back to Scrypted.');
                })
                : undefined;
            session.videoReturnRtcpReady = videoReturnRtcpReady;

            console.log({
                dynamicBitrate,
                isLowBandwidth,
                isWatch,
                destination,
            });

            session.startRequest = request as StartStreamRequest;
            const vrtcp = new SrtcpSession(session.vconfig);

            let idleTimeout: NodeJS.Timeout;
            // watch for data to verify other side is alive.
            const resetIdleTimeout = () => {
                clearTimeout(idleTimeout);
                idleTimeout = setTimeout(() => {
                    console.log('HomeKit Streaming RTCP timed out. Terminating Streaming.');
                    session.kill();
                }, 30000);
            }
            session.killPromise.finally(() => clearTimeout(idleTimeout));

            // There are two modes for sending rtp audio/video to homekit: ffmpeg and scrypted's custom implementation.
            // When using FFmpeg, the video and audio return rtcp and return packets are received on the correct ports.
            // However, the video and audio (when using AAC) are send from random ffmpeg ports. FFmpeg does not
            // support rtp/rtcp mux. There's currently a test path that does support forwarding video from the
            // correct port, but it is not enabled by default, since there seems to be no issues with HomeKit
            // accepting data from a random port. This, however, may be problematic with UDP punching if
            // the iOS device is behind a firewall for some weird reason.
            // When using Scrypted, the correct ports are used.
            // This packet loss logger seems to quickly (around 500ms) report a missing packet, if
            // the Home app does not start receiving packets. This is easily reproduceable with FFmpeg,
            // as it is slow to start.
            let lastPacketLoss = 0;
            const logPacketLoss = (rr: RtcpRrPacket) => {
                if (rr.reports[0]?.packetsLost && rr.reports[0].packetsLost !== lastPacketLoss) {
                    console.log('packet loss', rr.reports[0].packetsLost);
                    lastPacketLoss = rr.reports[0].packetsLost;
                }
            }

            const transcodingDebugMode = storage.getItem('transcodingDebugMode') === 'true';
            const mediaOptions: RequestMediaStreamOptions = {
                destination,
                video: {
                    codec: 'h264',
                },
                audio: {
                    // opus is the preferred/default codec, and can be repacketized to fit any request if in use.
                    // otherwise audio streaming for aac-eld needs to be transcoded, since nothing outputs aac-eld natively.
                    // pcm/g711 the second best option for aac-eld, since it's raw audio.
                    codec: request.audio.codec === AudioStreamingCodecType.OPUS ? 'opus' : 'pcm',
                },
                tool: transcodingDebugMode ? 'ffmpeg' : 'scrypted',
            };

            const videoInput = await mediaManager.convertMediaObjectToJSON<FFmpegInput>(await device.getVideoStream(mediaOptions), ScryptedMimeTypes.FFmpegInput);
            session.mediaStreamOptions = videoInput.mediaStreamOptions;
            const minBitrate = session.mediaStreamOptions?.video?.minBitrate;
            const maxBitrate = session.mediaStreamOptions?.video?.maxBitrate;

            if (dynamicBitrate && maxBitrate && minBitrate) {
                const initialBitrate = request.video.max_bit_rate * 1000;
                let dynamicBitrateSession = new DynamicBitrateSession(initialBitrate, minBitrate, maxBitrate, console);

                session.tryReconfigureBitrate = (reason: string, bitrate: number) => {
                    dynamicBitrateSession.onBitrateReconfigured(bitrate);
                    const reconfigured: MediaStreamOptions = Object.assign({
                        id: session.mediaStreamOptions?.id,
                        video: {
                        },
                    }, session.mediaStreamOptions || {});
                    reconfigured.video.bitrate = bitrate;

                    console.log(`reconfigure bitrate (${reason}) ${bitrate}`);
                    device.setVideoStreamOptions(reconfigured);
                }

                session.tryReconfigureBitrate('start', initialBitrate);

                session.videoReturn.on('message', data => {
                    resetIdleTimeout();
                    const d = vrtcp.decrypt(data);
                    const rtcp = RtcpPacketConverter.deSerialize(d);
                    const rr = rtcp.find(packet => packet.type === 201) as RtcpRrPacket;
                    if (!rr)
                        return;
                    logPacketLoss(rr);
                    if (dynamicBitrateSession.shouldReconfigureBitrate(rr))
                        session.tryReconfigureBitrate('rtcp', dynamicBitrateSession.currentBitrate)
                });

                // reset the video bitrate to max after a dynanic bitrate session ends.
                session.videoReturn.on('close', async () => {
                    session.tryReconfigureBitrate('stop', session.mediaStreamOptions?.video?.maxBitrate);
                });
            }
            else {
                session.videoReturn.on('message', data => {
                    resetIdleTimeout();
                    const d = vrtcp.decrypt(data);
                    const rtcp = RtcpPacketConverter.deSerialize(d);
                    const rr = rtcp.find(packet => packet.type === 201) as RtcpRrPacket;
                    if (!rr)
                        return;
                    logPacketLoss(rr);
                });
            }

            resetIdleTimeout();

            try {
                await startCameraStreamFfmpeg(device,
                    console,
                    storage,
                    destination,
                    videoInput,
                    session);
            }
            catch (e) {
                console.error('streaming error', e);
                return;
            }

            // audio talkback
            if (twoWayAudio) {
                const socketType = session.prepareRequest.addressVersion === 'ipv6' ? 'udp6' : 'udp4';
                const audioKey = Buffer.concat([session.prepareRequest.audio.srtp_key, session.prepareRequest.audio.srtp_salt]);

                // this is a bit hacky, as it picks random ports and spams audio at it.
                // the resultant port is returned as an ffmpeg input to the device intercom,
                // if it has one. which, i guess works.
                const rtpSink = await startRtpSink(socketType, session.prepareRequest.targetAddress,
                    audioKey, session.startRequest.audio, console);
                session.killPromise.finally(() => rtpSink.destroy());

                // demux the audio return socket to distinguish between rtp audio return
                // packets and rtcp.
                // send the audio return off to the rtp
                let startedIntercom = false;
                session.audioReturn.on('message', buffer => {
                    const rtp = RtpPacket.deSerialize(buffer);
                    if (rtp.header.payloadType === session.startRequest.audio.pt) {
                        if (!startedIntercom) {
                            console.log('Received first two way audio packet, starting intercom.');
                            startedIntercom = true;
                            mediaManager.createFFmpegMediaObject(rtpSink.ffmpegInput)
                                .then(mo => {
                                    device.startIntercom(mo);
                                    session.audioReturn.once('close', () => {
                                        console.log('Stopping intercom.');
                                        device.stopIntercom();
                                    });
                                });
                        }
                        session.audioReturn.send(buffer, rtpSink.rtpPort);
                    }
                    else {
                        rtpSink.heartbeat(session.audioReturn, buffer);
                    }
                });
            }
        },
    };

    return delegate;
}
