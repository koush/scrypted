import { RtpPacket } from '@koush/werift-src/packages/rtp/src/index';
import type { RtcpRrPacket } from '@koush/werift-src/packages/rtp/src/rtcp/rr';
import { RtcpPacketConverter } from '@koush/werift-src/packages/rtp/src/rtcp/rtcp';
import { ProtectionProfileAes128CmHmacSha1_80 } from '@koush/werift-src/packages/rtp/src/srtp/const';
import { SrtcpSession } from '@koush/werift-src/packages/rtp/src/srtp/srtcp';
import { SrtpSession } from '@koush/werift-src/packages/rtp/src/srtp/srtp';
import { bindUdp, closeQuiet, listenZeroSingleClient } from '@scrypted/common/src/listen-cluster';
import { timeoutPromise } from '@scrypted/common/src/promise-utils';
import { RtspServer } from '@scrypted/common/src/rtsp-server';
import { addTrackControls, parseSdp } from '@scrypted/common/src/sdp-utils';
import sdk, { Camera, FFmpegInput, Intercom, MediaStreamFeedback, RequestMediaStreamOptions, ScryptedDevice, ScryptedInterface, ScryptedMimeTypes, VideoCamera, VideoCameraConfiguration } from '@scrypted/sdk';
import dgram, { SocketType } from 'dgram';
import { once } from 'events';
import os from 'os';
import { getAddressOverride } from '../../address-override';
import { AudioStreamingCodecType, CameraController, CameraStreamingDelegate, PrepareStreamCallback, PrepareStreamRequest, PrepareStreamResponse, StartStreamRequest, StreamingRequest, StreamRequestCallback, StreamRequestTypes } from '../../hap';
import type { HomeKitPlugin } from "../../main";
import { createReturnAudioSdp } from './camera-return-audio';
import { createSnapshotHandler } from '../camera/camera-snapshot';
import { getDebugMode } from './camera-debug-mode-storage';
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
            let addressOverride = await getAddressOverride();

            if (addressOverride) {
                const infos = Object.values(os.networkInterfaces()).flat().map(i => i?.address);
                if (!infos.find(address => address === addressOverride)) {
                    const error = 'The provided Scrypted Server Address was not found in the list of network addresses and may be invalid and will not be used (DHCP assignment change?): ' + addressOverride;
                    console.error(error);
                    sdk.log.a(error);
                    addressOverride = undefined;
                }
            }

            const { socket: videoReturn, port: videoPort } = await getPort(socketType, addressOverride);
            const { socket: audioReturn, port: audioPort } = await getPort(socketType, addressOverride);
            videoReturn.setSendBufferSize(1024 * 1024);
            audioReturn.setSendBufferSize(1024 * 1024);

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
                console.warn('===========================================================================');
                console.warn('The Scrypted Server Address is not set in the Scrypted settings.');
                console.warn('If there are issues streaming, set this address to your wired IP address manually.');
                console.warn('More information can be found in the HomeKit Plugin README.');
                console.warn('===========================================================================');

                sdk.log.a('The Scrypted Server Address should be set in the Scrypted settings. More information can be found in the HomeKit Plugin README.');

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

                // ignore the IP if it is APIPA (Automatic Private IP Addressing)
                if (check?.startsWith('169.')) {
                    check = undefined;
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

            const debugMode = getDebugMode(storage);
            const mediaOptions: RequestMediaStreamOptions = {
                destination,
                destinationId: session.prepareRequest.targetAddress,
                adaptive: true,
                video: {
                    codec: 'h264',
                    bitrate: request.video.max_bit_rate * 1000,
                },
                audio: {
                    // opus is the preferred/default codec, and can be repacketized to fit any request if in use.
                    // otherwise audio streaming for aac-eld needs to be transcoded, since nothing outputs aac-eld natively.
                    // pcm/g711 the second best option for aac-eld, since it's raw audio.
                    codec: request.audio.codec === AudioStreamingCodecType.OPUS ? 'opus' : 'pcm',
                },
                tool: debugMode.video ? 'ffmpeg' : 'scrypted',
            };

            const mediaObject = await device.getVideoStream(mediaOptions);
            const videoInput = await mediaManager.convertMediaObjectToJSON<FFmpegInput>(mediaObject, ScryptedMimeTypes.FFmpegInput);
            let mediaStreamFeedback: MediaStreamFeedback;
            try {
                mediaStreamFeedback = await sdk.mediaManager.convertMediaObject(mediaObject, ScryptedMimeTypes.MediaStreamFeedback);
            }
            catch (e) {
            }

            session.mediaStreamOptions = videoInput.mediaStreamOptions;

            session.tryReconfigureBitrate = (reason: string, bitrate: number) => {
                if (!mediaStreamFeedback) {
                    console.log('Media Stream reconfiguration was requested. Upgrade to Scrypted NVR for adaptive bitrate support.');
                    return;
                }
                mediaStreamFeedback.reconfigureStream({
                    video: {
                        bitrate,
                    }
                });
            }

            session.videoReturn.on('message', data => {
                resetIdleTimeout();
                const rtcpBuffer = vrtcp.decrypt(data);
                if (mediaStreamFeedback) {
                    mediaStreamFeedback.onRtcp(rtcpBuffer);
                    return;
                }

                const rtcp = RtcpPacketConverter.deSerialize(rtcpBuffer);
                const rr = rtcp.find(packet => packet.type === 201) as RtcpRrPacket;
                logPacketLoss(rr);
            });

            resetIdleTimeout();

            try {
                await startCameraStreamFfmpeg(device,
                    console,
                    storage,
                    videoInput,
                    session);
            }
            catch (e) {
                console.error('streaming error', e);
                return;
            }

            // audio talkback
            if (twoWayAudio) {
                let rtspServer: RtspServer;
                let track: string;
                let playing = false;
                session.audioReturn.once('message', async buffer => {
                    try {
                        const { clientPromise, url } = await listenZeroSingleClient();
                        const rtspUrl = url.replace('tcp', 'rtsp');
                        let sdp = createReturnAudioSdp(session.startRequest.audio);
                        sdp = addTrackControls(sdp);
                        const parsed = parseSdp(sdp);
                        track = parsed.msections[0].control;
                        const isOpus = session.startRequest.audio.codec === AudioStreamingCodecType.OPUS;

                        const ffmpegInput: FFmpegInput = {
                            url: rtspUrl,
                            // this may not work if homekit is using aac to deliver audio, since 
                            inputArguments: [
                                "-acodec", isOpus ? "libopus" : "libfdk_aac",
                                '-i', rtspUrl,
                            ],
                        };
                        const mo = await mediaManager.createFFmpegMediaObject(ffmpegInput, {
                            sourceId: device.id,
                        });
                        device.startIntercom(mo).catch(e => console.error('intercom failed to start', e));

                        const client = await clientPromise;

                        const cleanup = () => {
                            // remove listeners to prevent a double invocation of stopIntercom.
                            client.removeAllListeners();
                            console.log('Stopping intercom.');
                            device.stopIntercom();
                            client.destroy();
                            rtspServer = undefined;
                            playing = false;
                        }
                        // stop the intercom if the client dies for any reason.
                        // allow the streaming session to continue however.
                        client.on('close', cleanup);
                        session.killPromise.finally(cleanup);

                        rtspServer = new RtspServer(client, sdp);
                        await rtspServer.handlePlayback();
                        playing = true;
                    }
                    catch (e) {
                        console.error('two way audio failed', e);
                    }
                });

                const srtpSession = new SrtpSession(session.aconfig);
                session.audioReturn.on('message', buffer => {
                    if (!playing)
                        return;

                    const decrypted = srtpSession.decrypt(buffer);
                    const rtp = RtpPacket.deSerialize(decrypted);

                    if (rtp.header.payloadType !== session.startRequest.audio.pt)
                        return;

                    rtspServer.sendTrack(track, decrypted, false);
                });
            }
        },
    };

    return delegate;
}
