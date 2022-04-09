import dgram from 'dgram';
import { RtcpSenderInfo, RtcpSrPacket } from '../../../../../external/werift/packages/rtp/src/rtcp/sr';
import { RtpPacket } from '../../../../../external/werift/packages/rtp/src/rtp/rtp';
import { Config } from '../../../../../external/werift/packages/rtp/src/srtp/session';
import { SrtcpSession } from '../../../../../external/werift/packages/rtp/src/srtp/srtcp';
import { SrtpSession } from '../../../../../external/werift/packages/rtp/src/srtp/srtp';
import { AudioStreamingSamplerate } from '../../hap';
import { ntpTime } from './camera-utils';
import { OpusRepacketizer } from './opus-repacketizer';

export function createCameraStreamSender(config: Config, sender: dgram.Socket, ssrc: number, payloadType: number, port: number, targetAddress: string, rtcpInterval: number, audioOptions?: {
    audioPacketTime: number,
    audioSampleRate: AudioStreamingSamplerate,
    framesPerPacket: number,
}) {
    const srtpSession = new SrtpSession(config);
    const srtcpSession = new SrtcpSession(config);

    let firstTimestamp = 0;
    let lastTimestamp = 0;
    let octetCount = 0;
    let lastRtcp = 0;
    let firstSequenceNumber = 0;
    let allowRollover = false;
    let rolloverCount = 0;
    let packetizer: OpusRepacketizer;

    let audioIntervalScale = 1;
    if (audioOptions) {
        switch (audioOptions.audioSampleRate) {
            case AudioStreamingSamplerate.KHZ_24:
                audioIntervalScale = 3;
                break;
            case AudioStreamingSamplerate.KHZ_16:
                audioIntervalScale = 2;
                break;
        }
        audioIntervalScale = audioIntervalScale * audioOptions.audioPacketTime / 20;
        packetizer = new OpusRepacketizer(audioOptions.framesPerPacket);
    }

    return (rtp: RtpPacket) => {
        const now = Date.now();

        if (!firstSequenceNumber)
            firstSequenceNumber = rtp.header.sequenceNumber;

        // rough rollover detection to keep packet count accurate.
        // once within 256 packets of the 0 and 65536, wait for rollover.
        if (!allowRollover) {
            if (rtp.header.sequenceNumber > 0xFF00)
                allowRollover = true;
        }
        else if (rtp.header.sequenceNumber < 0x00FF) {
            allowRollover = false;
            rolloverCount++;
        }

        if (!firstTimestamp)
            firstTimestamp = rtp.header.timestamp;

        // depending where this stream is coming from (ie, rtsp/udp), we may not actually know how many packets
        // have been lost. just infer this i guess. unfortunately it is not possible to infer the octet count that
        // has been lost. should we make something up? does HAP behave correctly with only missing packet indicators?
        let packetCount = (rtp.header.sequenceNumber - firstSequenceNumber) + (rolloverCount * 0x10000);

        if (audioOptions.audioPacketTime) {
            packetCount = Math.floor(packetCount / audioOptions.framesPerPacket);
            rtp = packetizer.repacketize(rtp);
            if (!rtp)
                return;

            // from HAP spec:
            // RTP Payload Format for Opus Speech and Audio Codec RFC 7587 with an exception
            // that Opus audio RTP Timestamp shall be based on RFC 3550.
            // RFC 3550 indicates that PCM audio based with a sample rate of 8k and a packet
            // time of 20ms would have a monotonic interval of 8k / (1000 / 20) = 160.
            // So 24k audio would have a monotonic interval of (24k / 8k) * 160 = 480.
            // HAP spec also states that it may request packet times of 20, 30, 40, or 60.
            // In practice, HAP has been seen to request 20 on LAN and 60 over LTE.
            // So the RTP timestamp must scale accordingly.

            // Further investigation indicates that HAP doesn't care about the actual sample rate at all,
            // that's merely a suggestion. When encoding Opus, it can seemingly be an arbitrary sample rate,
            // audio will work so long as the rtp timestamps are created properly: which is a construct of the sample rate
            // HAP requests, and the packet time is respected,
            // opus 48khz will work just fine.
            rtp.header.timestamp = (firstTimestamp + packetCount * 180 * audioIntervalScale) % 0xFFFFFFFF;
        }

        lastTimestamp = rtp.header.timestamp;

        // packet count may be less than zero if rollover counting fails due to heavy packet loss or other
        // unforseen edge cases.
        if (now > lastRtcp + rtcpInterval * 1000 && packetCount > 0) {
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
