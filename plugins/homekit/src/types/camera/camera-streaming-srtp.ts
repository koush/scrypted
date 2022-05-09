import { readLength } from '@scrypted/common/src/read-stream';
import { getSpsPps, parseSdp } from '@scrypted/common/src/sdp-utils';
import { FFmpegInput } from '@scrypted/sdk';
import net from 'net';
import { Readable } from 'stream';
import { RtspClient } from '../../../../../common/src/rtsp-server';
import { RtpPacket } from '../../../../../external/werift/packages/rtp/src/rtp/rtp';
import { CameraStreamingSession, KillCameraStreamingSession, waitForFirstVideoRtcp } from './camera-streaming-session';
import { createCameraStreamSender } from './camera-streaming-srtp-sender';

export interface AudioMode {
    mute: boolean;
    udpPort?: number;
}

export async function startCameraStreamSrtp(media: FFmpegInput, console: Console, audioMode: AudioMode, session: CameraStreamingSession, killSession: KillCameraStreamingSession) {
    const { url, mediaStreamOptions } = media;
    let { sdp } = mediaStreamOptions;
    let socket: Readable;
    let rtspClient: RtspClient;
    const isRtsp = url.startsWith('rtsp');
    let videoSender: (rtp: RtpPacket) => void;
    let audioSender: (rtp: RtpPacket) => void;

    const cleanup = () => {
        socket?.destroy();
        rtspClient?.safeTeardown();
        killSession();
    };

    if (isRtsp) {
        rtspClient = new RtspClient(url);
        rtspClient.requestTimeout = 1000;
        await rtspClient.options();
        const sdpResponse = await rtspClient.describe();
        sdp = sdpResponse.body.toString().trim();
        const parsedSdp = parseSdp(sdp);
        const video = parsedSdp.msections.find(msection => msection.type === 'video');
        const audio = parsedSdp.msections.find(msection => msection.type === 'audio');

        let channel = 0;
        if (audio && !audioMode.mute) {
            await rtspClient.setup({
                type: 'tcp',
                port: channel,
                path: audio.control,
                onData: (header, data) => {
                    const rtp = RtpPacket.deSerialize(data);
                    if (audioMode.udpPort) {
                        session.audioReturn.send(rtp.serialize(), audioMode.udpPort, '127.0.0.1');
                    }
                    else {
                        audioSender(rtp);
                    }
                },
            });
            channel += 2;
        }
        await rtspClient.setup({
            type: 'tcp',
            port: channel,
            path: video.control,
            onData: (header, data) => {
                const rtp = RtpPacket.deSerialize(data);
                videoSender(rtp);
            },
        });
        channel += 2;
        await rtspClient.play();
        rtspClient.client.once('close', cleanup);
        rtspClient.readLoop().finally(cleanup);
    }
    else {
        const u = new URL(url);
        socket = net.connect(parseInt(u.port), u.hostname);

        const startStreaming = async () => {
            try {
                let running = true;
                session.audioReturn.once('close', () => running = false);
                session.videoReturn.once('close', () => running = false);

                await waitForFirstVideoRtcp(console, session);

                while (running) {
                    const header = await readLength(socket, 2);
                    const length = header.readUInt16BE(0);
                    const data = await readLength(socket, length);
                    const rtp = RtpPacket.deSerialize(data);
                    if (!running)
                        break;
                    const isAudio = audioPayloadTypes.includes(rtp.header.payloadType);
                    const isVideo = videoPayloadTypes.includes(rtp.header.payloadType);
                    if (isAudio && isVideo)
                        throw new Error('audio and video on same channel?');

                    if (isAudio) {
                        if (audioMode.udpPort) {
                            session.audioReturn.send(rtp.serialize(), audioMode.udpPort, '127.0.0.1');
                        }
                        else {
                            audioSender(rtp);
                        }
                    }
                    else if (isVideo) {
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

        process.nextTick(startStreaming);
    }

    const parsedSdp = parseSdp(sdp);
    const video = parsedSdp.msections.find(msection => msection.type === 'video');

    let opusFramesPerPacket = session.startRequest.audio.packet_time / 20;

    videoSender = createCameraStreamSender(console, session.vconfig, session.videoReturn,
        session.videossrc, session.startRequest.video.pt,
        session.prepareRequest.video.port, session.prepareRequest.targetAddress,
        session.startRequest.video.rtcp_interval,
        {
            maxPacketSize: session.startRequest.video.mtu,
            ...getSpsPps(video),
        });
    audioSender = createCameraStreamSender(console, session.aconfig, session.audioReturn,
        session.audiossrc, session.startRequest.audio.pt,
        session.prepareRequest.audio.port, session.prepareRequest.targetAddress,
        session.startRequest.audio.rtcp_interval,
        undefined,
        {
            audioPacketTime: session.startRequest.audio.packet_time,
            audioSampleRate: session.startRequest.audio.sample_rate,
            framesPerPacket: opusFramesPerPacket,
        }
    );

    const audioPayloadTypes = parsedSdp.msections.find(msection => msection.type === 'audio')?.payloadTypes;
    const videoPayloadTypes = video?.payloadTypes;

    return sdp;
}
