
import sdk from '@scrypted/sdk';
import dgram from 'dgram';


import { SrtpSession } from '../../../../../external/werift/packages/rtp/src/srtp/srtp'
import { SrtcpSession } from '../../../../../external/werift/packages/rtp/src/srtp/srtcp'
import { RtpPacket } from '../../../../../external/werift/packages/rtp/src/rtp/rtp';
import { RtcpSenderInfo, RtcpSrPacket } from '../../../../../external/werift/packages/rtp/src/rtcp/sr';
import { Config } from '../../../../../external/werift/packages/rtp/src/srtp/session';
import { ntpTime } from './camera-utils';

export function createCameraStreamSender(config: Config, sender: dgram.Socket, ssrc: number, payloadType: number, port: number, targetAddress: string, rtcpInterval: number, audioPacketTime?: number) {
    const srtpSession = new SrtpSession(config);
    const srtcpSession = new SrtcpSession(config);

    let firstTimestamp = 0;
    let lastTimestamp = 0;
    let octetCount = 0;
    let lastRtcp = 0;
    let firstSequenceNumber = 0;

    return (rtp: RtpPacket) => {
        const now = Date.now();

        if (!firstSequenceNumber)
            firstSequenceNumber = rtp.header.sequenceNumber;

        // depending where this stream is coming from (ie, rtsp/udp), we may not actually know how many packets
        // have been lost. just infer this i guess. unfortunately it is not possible to infer the octet count that
        // has been lost. should we make something up? does HAP behave correctly with only missing packet indicators?
        const packetCount = rtp.header.sequenceNumber - firstSequenceNumber;

        if (!firstTimestamp)
            firstTimestamp = rtp.header.timestamp;

        if (audioPacketTime) {
            // from HAP spec:
            // RTP Payload Format for Opus Speech and Audio Codec RFC 7587 with an exception
            // that Opus audio RTP Timestamp shall be based on RFC 3550.
            // RFC 3550 indicates that 24k audio (which we advertise to HAP and it requests),
            // should have an interval of 480 when the packet time is 20.
            // HAP spec also states that it may request packet times of 20, 30, 40, or 60.
            // In practice, it requests 20 on LAN and 60 over LTE.
            // So the RTP timestamp must scale accordingly.
            // TODO: Support more sample rates from Opus besides 24k, to possibly
            // codec copy and repacketize?
            rtp.header.timestamp = firstTimestamp + packetCount * 480 * audioPacketTime / 20;
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
            sender.send(packet, port, targetAddress);
        }

        octetCount += rtp.payload.length;

        rtp.header.ssrc = ssrc;
        rtp.header.payloadType = payloadType;

        const srtp = srtpSession.encrypt(rtp.payload, rtp.header);
        sender.send(srtp, port, targetAddress);
    }
}
