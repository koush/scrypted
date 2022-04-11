import { readLength } from '@scrypted/common/src/read-stream';
import { parsePayloadTypes, parseSdp } from '@scrypted/common/src/sdp-utils';
import sdk, { RequestMediaStreamOptions, VideoCamera } from '@scrypted/sdk';
import net from 'net';
import { Readable } from 'stream';
import { RtspClient } from '../../../../../common/src/rtsp-server';
import { RtcpPacketConverter } from '../../../../../external/werift/packages/rtp/src/rtcp/rtcp';
import { RtpPacket } from '../../../../../external/werift/packages/rtp/src/rtp/rtp';
import { ProtectionProfileAes128CmHmacSha1_80 } from '../../../../../external/werift/packages/rtp/src/srtp/const';
import { SrtcpSession } from '../../../../../external/werift/packages/rtp/src/srtp/srtcp';
import { CameraStreamingSession, KillCameraStreamingSession } from './camera-streaming-session';
import { createCameraStreamSender } from './camera-streaming-srtp-sender';

const { mediaManager } = sdk;

export async function startCameraStreamSrtp(media: any, console: Console, session: CameraStreamingSession, killSession: KillCameraStreamingSession) {
    const vconfig = {
        keys: {
            localMasterKey: session.prepareRequest.video.srtp_key,
            localMasterSalt: session.prepareRequest.video.srtp_salt,
            remoteMasterKey: session.prepareRequest.video.srtp_key,
            remoteMasterSalt: session.prepareRequest.video.srtp_salt,
        },
        profile: ProtectionProfileAes128CmHmacSha1_80,
    };
    const aconfig = {
        keys: {
            localMasterKey: session.prepareRequest.audio.srtp_key,
            localMasterSalt: session.prepareRequest.audio.srtp_salt,
            remoteMasterKey: session.prepareRequest.audio.srtp_key,
            remoteMasterSalt: session.prepareRequest.audio.srtp_salt,
        },
        profile: ProtectionProfileAes128CmHmacSha1_80,
    };

    const asrtcp = new SrtcpSession(aconfig);
    session.audioReturn.on('message', data => {
        const d = asrtcp.decrypt(data);
        const rtcp = RtcpPacketConverter.deSerialize(d);
        console.log(rtcp);
    })

    let { url, sdp, mediaStreamOptions } = media;
    session.mediaStreamOptions = mediaStreamOptions;
    let socket: Readable;
    const isRtsp = url.startsWith('rtsp');

    const cleanup = () => {
        socket.destroy();
        killSession();
    };

    if (isRtsp) {
        const rtspClient = new RtspClient(url);
        await rtspClient.options();
        const sdpResponse = await rtspClient.describe();
        sdp = sdpResponse.body.toString().trim();
        const parsedSdp = parseSdp(sdp);
        const video = parsedSdp.msections.find(msection => msection.type === 'video');
        const audio = parsedSdp.msections.find(msection => msection.type === 'audio');
        await rtspClient.setup(0, audio.control);
        await rtspClient.setup(2, video.control);
        await rtspClient.play();
        socket = rtspClient.rfc4571;

        const cleanupClient = () => {
            rtspClient.client.destroy();
            killSession();
        }

        socket.once('close', cleanupClient);
        rtspClient.readLoop().finally(cleanupClient);
    }
    else {
        const u = new URL(url);
        socket = net.connect(parseInt(u.port), u.hostname);
    }

    const parsedSdp = parseSdp(sdp);
    const audioPayloadTypes = parsedSdp.msections.find(msection => msection.type === 'audio')?.payloadTypes;
    const videoPayloadTypes = parsedSdp.msections.find(msection => msection.type === 'video')?.payloadTypes;

    const startStreaming = async () => {
        try {
            let opusFramesPerPacket = session.startRequest.audio.packet_time / 20;

            const videoSender = createCameraStreamSender(vconfig, session.videoReturn,
                session.videossrc, session.startRequest.video.pt,
                session.prepareRequest.video.port, session.prepareRequest.targetAddress,
                session.startRequest.video.mtu, session.startRequest.video.rtcp_interval);
            const audioSender = createCameraStreamSender(aconfig, session.audioReturn,
                session.audiossrc, session.startRequest.audio.pt,
                session.prepareRequest.audio.port, session.prepareRequest.targetAddress,
                undefined,
                session.startRequest.audio.rtcp_interval,
                {
                    audioPacketTime: session.startRequest.audio.packet_time,
                    audioSampleRate: session.startRequest.audio.sample_rate,
                    framesPerPacket: opusFramesPerPacket,
                }
            );
            while (true) {
                // trim the rtsp framing
                if (isRtsp)
                    await readLength(socket, 2);
                const header = await readLength(socket, 2);
                const length = header.readUInt16BE(0);
                const data = await readLength(socket, length);
                const rtp = RtpPacket.deSerialize(data);
                if (audioPayloadTypes.includes(rtp.header.payloadType)) {
                    audioSender(rtp);
                }
                else if (videoPayloadTypes.includes(rtp.header.payloadType)) {
                    videoSender(rtp);
                }
                else {
                    console.warn('invalid payload type', rtp.header.payloadType);
                }
            }
        }
        catch (e) {
            console.error('streaming ended', e);
        }
        finally {
            cleanup();
        }
    }

    startStreaming();
}
