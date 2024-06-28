import { RtcpSenderInfo, RtcpSrPacket } from '@koush/werift-src/packages/rtp/src/rtcp/sr';
import { RtpPacket } from '@koush/werift-src/packages/rtp/src/rtp/rtp';
import type { Config } from '@koush/werift-src/packages/rtp/src/srtp/session';
import { SrtcpSession } from '@koush/werift-src/packages/rtp/src/srtp/srtcp';
import { SrtpSession } from '@koush/werift-src/packages/rtp/src/srtp/srtp';
import { getNaluTypesInNalu, H264_NAL_TYPE_IDR } from '@scrypted/common/src/rtsp-server';
import dgram from 'dgram';
import { AudioStreamingSamplerate } from '../../hap';
import { ntpTime } from './camera-utils';
import { H264Repacketizer } from './h264-packetizer';
import { OpusRepacketizer } from './opus-repacketizer';
import throttle from 'lodash/throttle';

export function createCameraStreamSender(console: Console, config: Config, sender: dgram.Socket, ssrc: number, payloadType: number, port: number, targetAddress: string, rtcpInterval: number,
    videoOptions?: {
        maxPacketSize: number,
        sps: Buffer,
        pps: Buffer,
    },
    audioOptions?: {
        audioPacketTime: number,
        audioSampleRate: AudioStreamingSamplerate,
        framesPerPacket: number,
    }) {
    const srtpSession = new SrtpSession(config);
    const srtcpSession = new SrtcpSession(config);

    let firstTimestamp = 0;
    let lastTimestamp = 0;
    let packetCount = 0;
    let octetCount = 0;
    let lastRtcp = 0;
    let firstSequenceNumber: number;
    let opusPacketizer: OpusRepacketizer;
    let h264Packetizer: H264Repacketizer;
    let analyzeVideo = true;

    const loggedNaluTypes = new Set<number>();
    const printNaluTypes = () => {
        if (!loggedNaluTypes.size)
            return;
        console.log('scanning for idr start found:', ...[...loggedNaluTypes]);
        loggedNaluTypes.clear();
    };
    const logIdrCheck = throttle(() => {
        printNaluTypes();
    }, 1000);

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
        opusPacketizer = new OpusRepacketizer(audioOptions.framesPerPacket);
    }
    else {
        if (videoOptions.maxPacketSize) {
            // adjust packet size for the rtp packet header (12).
            const adjustedMtu = videoOptions.maxPacketSize - 12;
            h264Packetizer = new H264Repacketizer(console, adjustedMtu, videoOptions);
        }
        sender.setSendBufferSize(1024 * 1024);
    }

    function sendRtcpInternal(now: number) {
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

    function sendRtcp() {
        const now = Date.now();
        return sendRtcpInternal(now);
    }

    function sendPacket(rtp: RtpPacket) {
        const now = Date.now();

        // packet count may be less than zero if rollover counting fails due to heavy packet loss or other
        // unforseen edge cases.
        if (now > lastRtcp + rtcpInterval * 1000) {
            sendRtcpInternal(now);
        }
        lastTimestamp = rtp.header.timestamp;

        packetCount++;
        octetCount += rtp.payload.length;

        rtp.header.padding = false;
        rtp.header.ssrc = ssrc;
        rtp.header.payloadType = payloadType;


        const srtp = srtpSession.encrypt(rtp.payload, rtp.header);
        sender.send(srtp, port, targetAddress);
    }

    function sendRtp(rtp: RtpPacket) {
        if (firstSequenceNumber === undefined) {
            console.log(`received first ${audioOptions ? 'audio' : 'video'} packet`);
            firstSequenceNumber = rtp.header.sequenceNumber;
        }

        if (!firstTimestamp)
            firstTimestamp = rtp.header.timestamp;

        if (audioOptions) {
            const packets = opusPacketizer.repacketize(rtp);
            if (!packets)
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
            for (const rtp of packets) {
                rtp.header.timestamp = (firstTimestamp + packetCount * 160 * audioIntervalScale) % 0xFFFFFFFF;
                sendPacket(rtp);
            }
            return;
        }

        if (!h264Packetizer) {
            sendPacket(rtp);
            return;
        }

        const packets = h264Packetizer.repacketize(rtp);
        if (!packets?.length)
            return;
        for (const packet of packets) {
            if (analyzeVideo) {
                const naluTypes = getNaluTypesInNalu(packet.payload, true);
                analyzeVideo = !naluTypes.has(H264_NAL_TYPE_IDR);
                if (analyzeVideo) {
                    naluTypes.forEach(loggedNaluTypes.add, loggedNaluTypes);
                    logIdrCheck();
                }
                else {
                    printNaluTypes();
                    console.log('idr start found:', ...[...naluTypes]);
                }
            }
            sendPacket(packet);
        }
    }

    return {
        sendRtp,
        sendRtcp,
    };
}
