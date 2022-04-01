import { safeKillFFmpeg } from '@scrypted/common/src/media-helpers';
import sdk, { Camera, Intercom, MediaStreamOptions, ScryptedDevice, ScryptedInterface, VideoCamera, VideoCameraConfiguration } from '@scrypted/sdk';
import dgram, { SocketType } from 'dgram';
import { once } from 'events';
import os from 'os';
import { RtcpRrPacket } from '../../../../../external/werift/packages/rtp/src/rtcp/rr';
import { RtcpPacketConverter } from '../../../../../external/werift/packages/rtp/src/rtcp/rtcp';
import { RtpPacket } from '../../../../../external/werift/packages/rtp/src/rtp/rtp';
import { ProtectionProfileAes128CmHmacSha1_80 } from '../../../../../external/werift/packages/rtp/src/srtp/const';
import { SrtcpSession } from '../../../../../external/werift/packages/rtp/src/srtp/srtcp';
import { HomeKitSession } from '../../common';
import { CameraController, CameraStreamingDelegate, PrepareStreamCallback, PrepareStreamRequest, PrepareStreamResponse, StartStreamRequest, StreamingRequest, StreamRequestCallback, StreamRequestTypes } from '../../hap';
import { startRtpSink } from '../../rtp/rtp-ffmpeg-input';
import { createSnapshotHandler } from '../camera/camera-snapshot';
import { DynamicBitrateSession } from './camera-dynamic-bitrate';
import { startCameraStreamFfmpeg } from './camera-streaming-ffmpeg';
import { CameraStreamingSession } from './camera-streaming-session';
import { startCameraStreamSrtp } from './camera-streaming-srtp';
import { getStreamingConfiguration } from './camera-utils';

const { mediaManager } = sdk;
const v4Regex = /^[\d]{1,3}\.[\d]{1,3}\.[\d]{1,3}\.[\d]{1,3}$/
const v4v6Regex = /^::ffff:[\d]{1,3}\.[\d]{1,3}\.[\d]{1,3}\.[\d]{1,3}$/;

export const CAMERA_STREAM_PERFECT_CODECS = false;

async function getPort(socketType?: SocketType): Promise<{ socket: dgram.Socket, port: number }> {
    const socket = dgram.createSocket(socketType || 'udp4');
    while (true) {
        const port = Math.round(10000 + Math.random() * 30000);
        socket.bind(port);
        await once(socket, 'listening');
        return { socket, port };
    }
}

export function createCameraStreamingDelegate(device: ScryptedDevice & VideoCamera & VideoCameraConfiguration & Camera & Intercom,
    console: Console,
    storage: Storage,
    homekitSession: HomeKitSession) {
    const sessions = new Map<string, CameraStreamingSession>();
    const twoWayAudio = device.interfaces?.includes(ScryptedInterface.Intercom);
    let idleTimeout: NodeJS.Timeout;

    function killSession(sessionID: string) {
        const session = sessions.get(sessionID);

        if (!session)
            return;

        console.log('streaming session killed');
        clearTimeout(idleTimeout);
        sessions.delete(sessionID);
        session.killed = true;
        safeKillFFmpeg(session.videoProcess);
        safeKillFFmpeg(session.audioProcess);
        session.videoReturn?.close();
        session.audioReturn?.close();
        session.rtpSink?.destroy();
        if (twoWayAudio)
            device.stopIntercom();
    }

    const delegate: CameraStreamingDelegate = {
        handleSnapshotRequest: createSnapshotHandler(device, storage, homekitSession, console),
        async prepareStream(request: PrepareStreamRequest, callback: PrepareStreamCallback) {

            const videossrc = CameraController.generateSynchronisationSource();
            const audiossrc = CameraController.generateSynchronisationSource();

            const socketType = request.addressVersion === 'ipv6' ? 'udp6' : 'udp4';
            const { socket: videoReturn, port: videoPort } = await getPort(socketType);
            const { socket: audioReturn, port: audioPort } = await getPort(socketType);


            const session: CameraStreamingSession = {
                killed: false,
                prepareRequest: request,
                startRequest: null,
                videossrc,
                audiossrc,
                videoProcess: null,
                audioProcess: null,
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
            const addressOverride = homekitSession.storage.getItem('addressOverride');
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

            if (request.type === StreamRequestTypes.RECONFIGURE) {
                session?.tryReconfigureBitrate('reconfigure', request.video.max_bit_rate * 1000);
                return;
            }

            session.startRequest = request as StartStreamRequest;

            const {
                selectedStream,
                dynamicBitrate,
                transcodeStreaming,
                isLowBandwidth,
                isWatch,
            } = await getStreamingConfiguration(device, storage, request)

            console.log({
                dynamicBitrate,
                isLowBandwidth,
                isWatch,
                transcodeStreaming,
                stream: selectedStream?.name || 'Default/undefined',
            });

            // if rebroadcast is being used, this will cause it to send
            // a prebuffer which hopefully contains a key frame.
            // it is safe to pipe this directly into ffmpeg because
            // ffmpeg starts streaming after it finds the key frame.
            selectedStream.prebuffer = undefined;

            const minBitrate = selectedStream?.video?.minBitrate;
            const maxBitrate = selectedStream?.video?.maxBitrate;

            session.startRequest = request as StartStreamRequest;

            if (dynamicBitrate) {
                const initialBitrate = request.video.max_bit_rate * 1000;
                const dynamicBitrateSession = new DynamicBitrateSession(initialBitrate, minBitrate, maxBitrate, console);

                session.tryReconfigureBitrate = (reason: string, bitrate: number) => {
                    dynamicBitrateSession.onBitrateReconfigured(bitrate);
                    const reconfigured: MediaStreamOptions = Object.assign({
                        id: selectedStream?.id,
                        video: {
                        },
                    }, selectedStream || {});
                    reconfigured.video.bitrate = bitrate;

                    console.log(`reconfigure bitrate (${reason}) ${bitrate}`);
                    device.setVideoStreamOptions(reconfigured);
                }

                session.tryReconfigureBitrate('start', initialBitrate);

                const vconfig = {
                    keys: {
                        localMasterKey: session.prepareRequest.video.srtp_key,
                        localMasterSalt: session.prepareRequest.video.srtp_salt,
                        remoteMasterKey: session.prepareRequest.video.srtp_key,
                        remoteMasterSalt: session.prepareRequest.video.srtp_salt,
                    },
                    profile: ProtectionProfileAes128CmHmacSha1_80,
                };
                const vrtcp = new SrtcpSession(vconfig);

                session.videoReturn.on('message', data => {
                    if (!dynamicBitrate)
                        return;
                    const d = vrtcp.decrypt(data);
                    const rtcp = RtcpPacketConverter.deSerialize(d);
                    const rr = rtcp.find(packet => packet.type === 201);
                    if (!rr)
                        return;
                    if (dynamicBitrateSession.shouldReconfigureBitrate(rr as RtcpRrPacket))
                        session.tryReconfigureBitrate('rtcp', dynamicBitrateSession.currentBitrate)
                });

                // reset the video bitrate to max after a dynanic bitrate session ends.
                session.videoReturn.on('close', async () => {
                    session.tryReconfigureBitrate('stop', maxBitrate);
                });
            }

            // watch for data to verify other side is alive.
            const resetIdleTimeout = () => {
                clearTimeout(idleTimeout);
                idleTimeout = setTimeout(() => {
                    console.log('HomeKit Streaming RTCP timed out. Terminating Streaming.');
                    killSession(request.sessionID);
                }, 30000);
            }

            session.videoReturn.on('message', () => {
                resetIdleTimeout();
            });
            resetIdleTimeout();

            try {
                if (CAMERA_STREAM_PERFECT_CODECS) {
                    await startCameraStreamSrtp(device, console, selectedStream, session, () => killSession(request.sessionID));
                }
                else {
                    await startCameraStreamFfmpeg(device,
                        console,
                        storage,
                        selectedStream,
                        transcodeStreaming,
                        session,
                        () => killSession(request.sessionID));
                }
            }
            catch (e) {
                console.error('streaming error', e);
            }

            // audio talkback
            if (twoWayAudio) {
                const socketType = session.prepareRequest.addressVersion === 'ipv6' ? 'udp6' : 'udp4';
                const audioKey = Buffer.concat([session.prepareRequest.audio.srtp_key, session.prepareRequest.audio.srtp_salt]);

                // this is a bit hacky, as it picks random ports and spams audio at it.
                // the resultant port is returned as an ffmpeg input to the device intercom,
                // if it has one. which, i guess works.
                session.rtpSink = await startRtpSink(socketType, session.prepareRequest.targetAddress,
                    audioKey, session.startRequest.audio, console);

                // demux the audio return socket to distinguish between rtp audio return
                // packets and rtcp.
                // send the audio return off to the rtp 
                session.audioReturn.on('message', buffer => {
                    const rtp = RtpPacket.deSerialize(buffer);
                    if (rtp.header.payloadType === session.startRequest.audio.pt) {
                        session.audioReturn.send(buffer, session.rtpSink.rtpPort);
                    }
                    else {
                        session.rtpSink.heartbeat(session.audioReturn, buffer);
                    }
                });

                const mo = await mediaManager.createFFmpegMediaObject(session.rtpSink.ffmpegInput);
                device.startIntercom(mo);
            }
        },
    };

    return delegate;
}
