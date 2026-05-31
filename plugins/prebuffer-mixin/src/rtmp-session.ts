import { RTSP_FRAME_MAGIC } from "@scrypted/common/src/rtsp-server";
import { StreamChunk } from "@scrypted/common/src/stream-parser";
import { ResponseMediaStreamOptions } from "@scrypted/sdk";
import { EventEmitter } from "stream";
import { RtpHeader, RtpPacket } from '../../../external/werift/packages/rtp/src/rtp/rtp';
import { H264Repacketizer } from "../../homekit/src/types/camera/h264-packetizer";
import { addRtpTimestamp, nextSequenceNumber } from "../../homekit/src/types/camera/jitter-buffer";
import { createAACRTPPayload } from "./au";
import { ParserSession, setupActivityTimer } from "./ffmpeg-rebroadcast";
import { parseFlvAudioTag, parseFlvVideoTag, VideoCodecId } from "./flv";
import { negotiateMediaStream } from "./rfc4571";
import { RtmpClient } from "./rtmp-client";

export type RtspChannelCodecMapping = { [key: number]: string };

export interface RtspSessionParserSpecific {
    interleaved: Map<string, number>;
}

export async function startRtmpSession(console: Console, url: string, mediaStreamOptions: ResponseMediaStreamOptions, options: {
    audioSoftMuted: boolean,
    rtspRequestTimeout: number,
}): Promise<ParserSession<"rtsp">> {
    let isActive = true;
    const events = new EventEmitter();
    // need this to prevent kill from throwing due to uncaught Error during cleanup
    events.on('error', () => { });

    const rtmpClient = new RtmpClient(url, console);

    const cleanupSockets = () => {
        rtmpClient.destroy();
    }

    let sessionKilled: any;
    const killed = new Promise<void>(resolve => {
        sessionKilled = resolve;
    });

    const kill = (error?: Error) => {
        if (isActive) {
            events.emit('killed');
            events.emit('error', error || new Error('killed'));
        }
        isActive = false;
        sessionKilled();
        cleanupSockets();
    };

    rtmpClient.socket.on('close', () => {
        kill(new Error('rtmp socket closed'));
    });
    rtmpClient.socket.on('error', e => {
        kill(e);
    });

    const { resetActivityTimer } = setupActivityTimer('rtsp', kill, events, options?.rtspRequestTimeout);

    try {
        await rtmpClient.setup();

        let sdp = `v=0
o=- 0 0 IN IP4 0.0.0.0
s=-
t=0 0
m=video 0 RTP/AVP 96
a=control:streamid=0
a=rtpmap:96 H264/90000`;
        if (!options?.audioSoftMuted) {
            sdp += `
m=audio 0 RTP/AVP 97
a=control:streamid=2
a=rtpmap:97 MPEG4-GENERIC/16000/1
a=fmtp:97 profile-level-id=1;mode=AAC-hbr;sizelength=13;indexlength=3;indexdeltalength=3; config=1408`;
        }

        sdp = sdp.split('\n').join('\r\n');

        const start = async () => {
            try {
                let audioSequenceNumber = 0;
                let videoSequenceNumber = 0;
                const h264Repacketizer = new H264Repacketizer(console, 32000);

                for await (const rtmpPacket of rtmpClient.readLoop()) {
                    if (!isActive)
                        break;

                    resetActivityTimer?.();

                    if (rtmpPacket.codec === 'audio') {
                        if (options?.audioSoftMuted)
                            continue;

                        const flv = parseFlvAudioTag(rtmpPacket.packet);

                        if (!flv.data?.length)
                            continue;

                        const header = new RtpHeader({
                            sequenceNumber: audioSequenceNumber,
                            timestamp: addRtpTimestamp(0, Math.floor(rtmpPacket.timestamp / 1000 * 16000)),
                            payloadType: 97,
                            marker: false,
                        });
                        audioSequenceNumber = nextSequenceNumber(audioSequenceNumber);

                        const audioPayload = createAACRTPPayload([flv.data]);
                        const rtp = new RtpPacket(header, audioPayload).serialize();

                        const prefix = Buffer.alloc(2);
                        prefix[0] = RTSP_FRAME_MAGIC;
                        prefix[1] = 2;

                        const length = Buffer.alloc(2);
                        length.writeUInt16BE(rtp.length, 0);

                        events.emit('rtsp', {
                            chunks: [Buffer.concat([prefix, length]), rtp],
                            type: 'aac',
                        });

                        continue;
                    }

                    if (rtmpPacket.codec !== 'video')
                        throw new Error('unknown rtmp codec ' + rtmpPacket.codec);

                    const flv = parseFlvVideoTag(rtmpPacket.packet);
                    if (flv.codecId !== VideoCodecId.H264)
                        throw new Error('unsupported rtmp video codec ' + flv.codecId);

                    const prefix = Buffer.alloc(2);
                    prefix[0] = RTSP_FRAME_MAGIC;
                    prefix[1] = 0;

                    const nalus: Buffer[] = [];
                    if (flv.nalus) {
                        nalus.push(...flv.nalus);
                    }
                    else if (flv.avcDecoderConfigurationRecord?.sps && flv.avcDecoderConfigurationRecord.pps) {
                        // make sure there's only one
                        if (flv.avcDecoderConfigurationRecord.sps.length > 1 || flv.avcDecoderConfigurationRecord.pps.length > 1)
                            throw new Error('rtmp sps/pps contains multiple nalus, only using the first of each');

                        nalus.push(flv.avcDecoderConfigurationRecord.sps[0]);
                        nalus.push(flv.avcDecoderConfigurationRecord.pps[0]);
                    }
                    else {
                        throw new Error('rtmp h264 nalus missing');
                    }

                    for (const nalu of nalus) {
                        const header = new RtpHeader({
                            sequenceNumber: videoSequenceNumber,
                            timestamp: addRtpTimestamp(0, Math.floor(rtmpPacket.timestamp / 1000 * 90000)),
                            payloadType: 96,
                            marker: true,
                        });
                        videoSequenceNumber = nextSequenceNumber(videoSequenceNumber);

                        const rtp = new RtpPacket(header, nalu);

                        const packets = h264Repacketizer.repacketize(rtp);

                        for (const packet of packets) {
                            const length = Buffer.alloc(2);
                            const rtp = packet.serialize();
                            length.writeUInt16BE(rtp.length, 0);

                            events.emit('rtsp', {
                                chunks: [Buffer.concat([prefix, length]), rtp],
                                type: 'h264',
                            });
                        }
                    }
                }
            }
            catch (e) {
                kill(e);
            }
            finally {
                kill(new Error('rtsp read loop exited'));
            }
        };

        // this return block is intentional, to ensure that the remaining code happens sync.
        return (() => {
            return {
                start,
                sdp: Promise.resolve(sdp),
                get isActive() { return isActive },
                kill(error?: Error) {
                    kill(error);
                },
                killed,
                resetActivityTimer,
                negotiateMediaStream: (requestMediaStream, inputVideoCodec, inputAudioCodec) => {
                    return negotiateMediaStream(sdp, mediaStreamOptions, inputVideoCodec, inputAudioCodec, requestMediaStream);
                },
                emit(container: 'rtsp', chunk: StreamChunk) {
                    events.emit(container, chunk);
                    return this;
                },
                on(event: string, cb: any) {
                    events.on(event, cb);
                    return this;
                },
                once(event: any, cb: any) {
                    events.once(event, cb);
                    return this;
                },
                removeListener(event, cb) {
                    events.removeListener(event, cb);
                    return this;
                }
            }
        })();
    }
    catch (e) {
        cleanupSockets();
        throw e;
    }
}
