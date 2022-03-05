import dgram from 'dgram';
import { RtcpSenderInfo, RtcpSrPacket } from '../../../../../external/werift/packages/rtp/src/rtcp/sr';
import { RtpPacket } from '../../../../../external/werift/packages/rtp/src/rtp/rtp';
import { Config } from '../../../../../external/werift/packages/rtp/src/srtp/session';
import { SrtcpSession } from '../../../../../external/werift/packages/rtp/src/srtp/srtcp';
import { SrtpSession } from '../../../../../external/werift/packages/rtp/src/srtp/srtp';
import { AudioStreamingSamplerate } from '../../hap';
import { ntpTime } from './camera-utils';

export function createCameraStreamSender(config: Config, sender: dgram.Socket, ssrc: number, payloadType: number, port: number, targetAddress: string, rtcpInterval: number, audioPacketTime?: number, audioSampleRate?: AudioStreamingSamplerate) {
    const srtpSession = new SrtpSession(config);
    const srtcpSession = new SrtcpSession(config);

    let firstTimestamp = 0;
    let lastTimestamp = 0;
    let octetCount = 0;
    let lastRtcp = 0;
    let firstSequenceNumber = 0;

    let audioIntervalScale = 1;
    if (audioPacketTime) {
        switch (audioSampleRate) {
            case AudioStreamingSamplerate.KHZ_24:
                audioIntervalScale = 3;
                break;
            case AudioStreamingSamplerate.KHZ_16:
                audioIntervalScale = 2;
                break;
        }
        audioIntervalScale = audioIntervalScale * audioPacketTime / 20;
    }

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
            // RFC 3550 indicates that PCM audio based with a sample rate of 8k and a packet
            // time of 20ms would have a monotonic interval of 8k / (1000 / 20) = 160.
            // So 24k audio would have a monotonic interval of (24k / 8k) * 160 = 480.
            // HAP spec also states that it may request packet times of 20, 30, 40, or 60.
            // In practice, HAP has been seen to request 20 on LAN and 60 over LTE.
            // So the RTP timestamp must scale accordingly.
            rtp.header.timestamp = firstTimestamp + packetCount * 180 * audioIntervalScale;
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
