import sdk, { Camera, Intercom, MediaStreamOptions, ScryptedDevice, ScryptedInterface, VideoCamera, VideoCameraConfiguration } from '@scrypted/sdk';
import dgram, { SocketType } from 'dgram';
import { once } from 'events';
import os from 'os';
import { RtcpReceiverInfo, RtcpRrPacket } from '../../../../../external/werift/packages/rtp/src/rtcp/rr';
import { RtcpPacketConverter } from '../../../../../external/werift/packages/rtp/src/rtcp/rtcp';
import { RtcpSrPacket } from '../../../../../external/werift/packages/rtp/src/rtcp/sr';
import { RtpPacket } from '../../../../../external/werift/packages/rtp/src/rtp/rtp';
import { ProtectionProfileAes128CmHmacSha1_80 } from '../../../../../external/werift/packages/rtp/src/srtp/const';
import { SrtcpSession } from '../../../../../external/werift/packages/rtp/src/srtp/srtcp';
import { HomeKitSession } from '../../common';
import { CameraController, CameraStreamingDelegate, PrepareStreamCallback, PrepareStreamRequest, PrepareStreamResponse, StartStreamRequest, StreamingRequest, StreamRequestCallback, StreamRequestTypes } from '../../hap';
import { startRtpSink } from '../../rtp/rtp-ffmpeg-input';
import { createSnapshotHandler } from '../camera/camera-snapshot';
import { startCameraStreamFfmpeg } from './camera-streaming-ffmpeg';
import { CameraStreamingSession } from './camera-streaming-session';
import { startCameraStreamSrtp } from './camera-streaming-srtp';

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
        session.cp?.kill('SIGKILL');
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
            const isHomeKitHub = homekitSession.isHomeKitHub(request.targetAddress);

            const session: CameraStreamingSession = {
                killed: false,
                isHomeKitHub,
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

            let selectedStream: MediaStreamOptions;

            const streamingChannel = session.isHomeKitHub
                ? storage.getItem('streamingChannelHub')
                : storage.getItem('streamingChannel');
            if (streamingChannel) {
                const msos = await device.getVideoStreamOptions();
                selectedStream = msos.find(mso => mso.name === streamingChannel);
            }

            const minBitrate = selectedStream?.video?.minBitrate;
            const maxBitrate = selectedStream?.video?.maxBitrate;

            const dynamicBitrate = storage.getItem('dynamicBitrate') === 'true'
                && session.isHomeKitHub
                && device.interfaces.includes(ScryptedInterface.VideoCameraConfiguration);

            let currentBitrate: number;
            let lastPerfectBitrate: number;
            let lastTotalPacketsLost = 0;
            const tryRtcpReconfigureBitrate = (rr: RtcpRrPacket) => {
                if (!dynamicBitrate)
                    return;

                let totalPacketsLost = 0;
                for (const report of rr.reports) {
                    totalPacketsLost += report.packetsLost;
                }

                const packetsLost = totalPacketsLost - lastTotalPacketsLost;
                lastTotalPacketsLost = totalPacketsLost;
                if (packetsLost === 0) {
                    lastPerfectBitrate = currentBitrate;
                    // what is a good rampup?
                    if (currentBitrate >= maxBitrate)
                        return;
                    currentBitrate = Math.round(currentBitrate * 1.25);
                }
                else {
                    if (currentBitrate <= minBitrate)
                        return;
                    // slow creep back up
                    if (currentBitrate > lastPerfectBitrate)
                        currentBitrate = lastPerfectBitrate * 1.05;
                    else
                        currentBitrate = Math.round(currentBitrate / 2);
                }

                currentBitrate = Math.max(minBitrate, currentBitrate);
                currentBitrate = Math.min(maxBitrate, currentBitrate);

                const reconfigured: MediaStreamOptions = Object.assign({
                    id: selectedStream?.id,
                    video: {
                    },
                }, selectedStream || {});
                reconfigured.video.bitrate = currentBitrate;
                console.log('Reconfigure bitrate (rtcp feedback):', currentBitrate, 'Packets lost:', packetsLost);
                device.setVideoStreamOptions(reconfigured);
            };

            const tryReconfigureBitrate = () => {
                if (!dynamicBitrate)
                    return;

                const reconfigured: MediaStreamOptions = Object.assign({
                    id: selectedStream?.id,
                    video: {
                    },
                }, selectedStream || {});
                currentBitrate = request.video.max_bit_rate * 1000;
                reconfigured.video.bitrate = currentBitrate;

                console.log('reconfigure bitrate (request):', currentBitrate);
                device.setVideoStreamOptions(reconfigured);
            }

            if (request.type === StreamRequestTypes.RECONFIGURE) {
                tryReconfigureBitrate();
                return;
            }
            else {
                session.startRequest = request as StartStreamRequest;
            }
            tryReconfigureBitrate();

            const vconfig = {
                keys: {
                    localMasterKey: session.prepareRequest.video.srtp_key,
                    localMasterSalt: session.prepareRequest.video.srtp_salt,
                    remoteMasterKey: session.prepareRequest.video.srtp_key,
                    remoteMasterSalt: session.prepareRequest.video.srtp_salt,
                },
                profile: ProtectionProfileAes128CmHmacSha1_80,
            };


            // watch for data to verify other side is alive.
            const resetIdleTimeout = () => {
                clearTimeout(idleTimeout);
                idleTimeout = setTimeout(() => {
                    console.log('HomeKit Streaming RTCP timed out. Terminating Streaming.');
                    killSession(request.sessionID);
                }, 30000);
            }

            const vrtcp = new SrtcpSession(vconfig);
            session.videoReturn.on('message', data => {
                resetIdleTimeout();
                if (!dynamicBitrate)
                    return;
                const d = vrtcp.decrypt(data);
                const rtcp = RtcpPacketConverter.deSerialize(d);
                const rr = rtcp.find(packet => packet.type === 201);
                if (!rr)
                    return;
                tryRtcpReconfigureBitrate(rr as RtcpRrPacket);
            });
            if (dynamicBitrate) {
                // reset the video bitrate to max after a dynanic bitrate session ends.
                session.videoReturn.on('close', async () => {
                    const reconfigured: MediaStreamOptions = Object.assign({
                        id: selectedStream?.id,
                        video: {
                        },
                    }, selectedStream || {});
                    reconfigured.video.bitrate = maxBitrate;
                    console.log('reconfigure bitrate (reset)', maxBitrate);
                    await device.setVideoStreamOptions(reconfigured);
                })
            }
            resetIdleTimeout();

            console.log('isHomeKitHub:', session.isHomeKitHub,
                'selected stream:', selectedStream?.name || 'Default/undefined',
                'audio.packet_time:', session.startRequest.audio.packet_time);

            try {
                if (CAMERA_STREAM_PERFECT_CODECS) {
                    await startCameraStreamSrtp(device, console, selectedStream, session, () => killSession(request.sessionID));
                }
                else {
                    await startCameraStreamFfmpeg(device,
                        console,
                        storage,
                        selectedStream,
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

                const mo = mediaManager.createFFmpegMediaObject(session.rtpSink.ffmpegInput);
                device.startIntercom(mo);
            }
        },
    };

    return delegate;
}
