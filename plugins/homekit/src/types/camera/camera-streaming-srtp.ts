import { readLength } from '@scrypted/common/src/read-stream';
import { parseSdp } from '@scrypted/common/src/sdp-utils';
import { FFmpegInput } from '@scrypted/sdk';
import net from 'net';
import { Readable } from 'stream';
import { RtspClient } from '../../../../../common/src/rtsp-server';
import { RtpPacket } from '../../../../../external/werift/packages/rtp/src/rtp/rtp';
import { CameraStreamingSession, KillCameraStreamingSession } from './camera-streaming-session';
import { createCameraStreamSender } from './camera-streaming-srtp-sender';

export async function startCameraStreamSrtp(media: FFmpegInput, console: Console, muteAudio: boolean, session: CameraStreamingSession, killSession: KillCameraStreamingSession) {
    const { url, mediaStreamOptions } = media;
    let { sdp } = mediaStreamOptions;
    let socket: Readable;
    const isRtsp = url.startsWith('rtsp');
    let audioChannel: number;
    let videoChannel: number;

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

        let channel = 0;
        if (audio && !muteAudio) {
            audioChannel = channel;
            channel += 2;
            await rtspClient.setup(audioChannel, audio.control);
        }
        videoChannel = channel;
        channel +=2;
        await rtspClient.setup(videoChannel, video.control);

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

            const videoSender = createCameraStreamSender(session.vconfig, session.videoReturn,
                session.videossrc, session.startRequest.video.pt,
                session.prepareRequest.video.port, session.prepareRequest.targetAddress,
                session.startRequest.video.mtu, session.startRequest.video.rtcp_interval);
            const audioSender = createCameraStreamSender(session.aconfig, session.audioReturn,
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
            let running = true;
            session.audioReturn.once('close', () => running = false);
            session.videoReturn.once('close', () => running = false);
            const headerLength = isRtsp ? 4 : 2;
            const lengthOffset = isRtsp ? 2 : 0;
            while (running) {
                let isAudio = false;
                let isVideo = false;
                const header = await readLength(socket, headerLength);
                const length = header.readUInt16BE(lengthOffset);
                const data = await readLength(socket, length);
                const rtp = RtpPacket.deSerialize(data);
                if (!running)
                    break;
                if (isRtsp) {
                    const channel = header.readUInt8(1);
                    isAudio = channel === audioChannel;
                    isVideo = channel === videoChannel;
                }
                else {
                    isAudio = audioPayloadTypes.includes(rtp.header.payloadType);
                    isVideo = videoPayloadTypes.includes(rtp.header.payloadType);
                }
                if (isAudio) {
                    audioSender(rtp);
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

    startStreaming();
}
