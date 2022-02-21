import { VideoCamera, MediaStreamOptions, RequestMediaStreamOptions } from '@scrypted/sdk'

import sdk from '@scrypted/sdk';

import net from 'net';

import { SrtcpSession } from '../../../../../external/werift/packages/rtp/src/srtp/srtcp'
import { readLength } from '@scrypted/common/src/read-stream';
import { parsePayloadTypes } from '@scrypted/common/src/sdp-utils';
import { RtpPacket } from '../../../../../external/werift/packages/rtp/src/rtp/rtp';
import { ProtectionProfileAes128CmHmacSha1_80 } from '../../../../../external/werift/packages/rtp/src/srtp/const';
import { RtcpPacketConverter } from '../../../../../external/werift/packages/rtp/src/rtcp/rtcp';
import { CameraStreamingSession, KillCameraStreamingSession } from './camera-streaming-session';
import { RtspClient } from '../../../../../common/src/rtsp-server';
import { createCameraStreamSender } from './camera-streaming-srtp-sender';

const { mediaManager } = sdk;

export async function startCameraStreamSrtp(device: & VideoCamera, console: Console, selectedStream: MediaStreamOptions, session: CameraStreamingSession, killSession: KillCameraStreamingSession) {
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

    const mo = await device.getVideoStream(Object.assign({
        // directMediaStream: true,
    } as RequestMediaStreamOptions, selectedStream));
    const rfc = await mediaManager.convertMediaObjectToJSON<any>(mo, mo.mimeType);
    let { url, sdp } = rfc;
    let socket: net.Socket;
    const isRtsp = url.startsWith('rtsp');
    if (isRtsp) {
        const rtspClient = new RtspClient(url);
        await rtspClient.options();
        const sdpResponse = await rtspClient.describe();
        sdp = sdpResponse.body.toString().trim();
        await rtspClient.setup(0, '/audio');
        await rtspClient.setup(2, '/video');
        socket = await rtspClient.play();
    }
    else {
        const u = new URL(url);
        socket = net.connect(parseInt(u.port), u.hostname);
    }

    const { audioPayloadTypes, videoPayloadTypes } = parsePayloadTypes(sdp);

    const cleanup = () => {
        socket.destroy();
        killSession();
    };

    const startStreaming = async () => {
        try {
            const videoSender = createCameraStreamSender(vconfig, session.videoReturn,
                session.videossrc, session.startRequest.video.pt,
                session.prepareRequest.video.port, session.prepareRequest.targetAddress,
                session.startRequest.video.rtcp_interval);
            const audioSender = createCameraStreamSender(aconfig, session.audioReturn,
                session.audiossrc, session.startRequest.audio.pt,
                session.prepareRequest.audio.port, session.prepareRequest.targetAddress,
                session.startRequest.audio.rtcp_interval, session.startRequest.audio.packet_time);
            while (true) {
                // trim the rtsp framing
                if (isRtsp)
                    await readLength(socket, 2);
                const header = await readLength(socket, 2);
                const length = header.readInt16BE(0);
                const data = await readLength(socket, length);
                const rtp = RtpPacket.deSerialize(data);
                if (audioPayloadTypes.has(rtp.header.payloadType)) {
                    audioSender(rtp);
                }
                else if (videoPayloadTypes.has(rtp.header.payloadType)) {
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
