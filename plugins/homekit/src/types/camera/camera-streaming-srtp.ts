import { VideoCamera, MediaStreamOptions, RequestMediaStreamOptions } from '@scrypted/sdk'

import sdk from '@scrypted/sdk';
import dgram from 'dgram';

import net from 'net';

import { SrtpSession } from '../../../../../external/werift/packages/rtp/src/srtp/srtp'
import { SrtcpSession } from '../../../../../external/werift/packages/rtp/src/srtp/srtcp'
import { readLength } from '@scrypted/common/src/read-stream';
import { RtpPacket } from '../../../../../external/werift/packages/rtp/src/rtp/rtp';
import { RtcpSenderInfo, RtcpSrPacket } from '../../../../../external/werift/packages/rtp/src/rtcp/sr';
import { ProtectionProfileAes128CmHmacSha1_80 } from '../../../../../external/werift/packages/rtp/src/srtp/const';
import { RtcpPacketConverter } from '../../../../../external/werift/packages/rtp/src/rtcp/rtcp';
import { Config } from '../../../../../external/werift/packages/rtp/src/srtp/session';
import { CameraStreamingSession, KillCameraStreamingSession } from './camera-streaming-session';
import { ntpTime } from './camera-utils';
import { RtspClient } from '../../../../../common/src/rtsp-server';

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

    const audioPt = new Set<number>();
    const videoPt = new Set<number>();
    const addPts = (set: Set<number>, pts: string[]) => {
        for (const pt of pts || []) {
            set.add(parseInt(pt));
        }
    };
    const audioPts = sdp.match(/m=audio.*/)?.[0];
    addPts(audioPt, audioPts?.split(' ').slice(3));
    const videoPts = (sdp as string).match(/m=video.*/)?.[0];
    addPts(videoPt, videoPts?.split(' ').slice(3));

    const cleanup = () => {
        socket.destroy();
        killSession();
    };

    const createSessionSender = (config: Config, dgram: dgram.Socket, ssrc: number, payloadType: number, port: number, rtcpInterval: number) => {
        const srtpSession = new SrtpSession(config);
        const srtcpSession = new SrtcpSession(config);

        let firstTimestamp = 0;
        let lastTimestamp = 0;
        let packetCount = 0;
        let octetCount = 0;
        let lastRtcp = 0;

        return (rtp: RtpPacket) => {
            const now = Date.now();

            if (!firstTimestamp)
                firstTimestamp = rtp.header.timestamp;

            if (audioPt.has(rtp.header.payloadType)) {
                // from HAP spec:
                // RTP Payload Format for Opus Speech and Audio Codec RFC 7587 with an exception
                // that Opus audio RTP Timestamp shall be based on RFC 3550.
                /// RFC 3550 indicates that 24k audio (which is we advertise to HAP and it requests),
                // should have an interval of 480.
                rtp.header.timestamp = firstTimestamp + packetCount * 480;
            }

            lastTimestamp = rtp.header.timestamp;

            if (now > lastRtcp + rtcpInterval * 1000) {
                lastRtcp = now;
                const sr = new RtcpSrPacket({
                    ssrc,
                    senderInfo: new RtcpSenderInfo({
                        ntpTimestamp: ntpTime(),
                        rtpTimestamp: lastTimestamp,
                        packetCount,
                        octetCount,
                    }),
                });

                const packet = srtcpSession.encrypt(sr.serialize());
                dgram.send(packet, port, session.prepareRequest.targetAddress);
            }

            octetCount += rtp.payload.length;
            packetCount++;

            rtp.header.ssrc = ssrc;
            rtp.header.payloadType = payloadType;


            const srtp = srtpSession.encrypt(rtp.payload, rtp.header);
            dgram.send(srtp, port, session.prepareRequest.targetAddress);
        }
    }

    const startStreaming = async () => {
        try {
            const vs = createSessionSender(vconfig, session.videoReturn,
                session.videossrc, session.startRequest.video.pt,
                session.prepareRequest.video.port, session.startRequest.video.rtcp_interval);
            const as = createSessionSender(aconfig, session.audioReturn,
                session.audiossrc, session.startRequest.audio.pt,
                session.prepareRequest.audio.port, session.startRequest.audio.rtcp_interval);
            while (true) {
                // trim the rtsp framing
                if (isRtsp)
                    await readLength(socket, 2);
                const header = await readLength(socket, 2);
                const length = header.readInt16BE(0);
                const data = await readLength(socket, length);
                const rtp = RtpPacket.deSerialize(data);
                if (audioPt.has(rtp.header.payloadType)) {
                    as(rtp);
                }
                else if (videoPt.has(rtp.header.payloadType)) {
                    vs(rtp);
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
