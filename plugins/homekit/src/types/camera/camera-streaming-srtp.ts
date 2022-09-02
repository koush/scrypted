import { RtpPacket } from '@koush/werift-src/packages/rtp/src/rtp/rtp';
import { getSpsPps, parseSdp } from '@scrypted/common/src/sdp-utils';
import { FFmpegInput } from '@scrypted/sdk';
import { Readable } from 'stream';
import { RtspClient } from '../../../../../common/src/rtsp-server';
import { CameraStreamingSession, waitForFirstVideoRtcp } from './camera-streaming-session';
import { createCameraStreamSender } from './camera-streaming-srtp-sender';

export interface AudioMode {
    mute: boolean;
    udpPort?: number;
}

export async function startCameraStreamSrtp(media: FFmpegInput, console: Console, audioMode: AudioMode, session: CameraStreamingSession) {
    const { url, mediaStreamOptions } = media;
    let { sdp } = mediaStreamOptions;
    let videoSender: (rtp: RtpPacket) => void;
    let audioSender: (rtp: RtpPacket) => void;

    const rtspClient = new RtspClient(url);
    rtspClient.requestTimeout = 1000;

    const cleanup = () => {
        rtspClient?.safeTeardown();
        session.kill();
    };

    session.killPromise.finally(cleanup);
    rtspClient.client.once('close', cleanup);

    try {
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
                onRtp: (header, data) => {
                    if (session.killed)
                        return;
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
            onRtp: (header, data) => {
                if (session.killed)
                    return;
                const rtp = RtpPacket.deSerialize(data);
                videoSender(rtp);
            },
        });
        channel += 2;

        if (session.killed)
            throw new Error('killed');
    }
    catch (e) {
        cleanup();
        throw e;
    }

    const parsedSdp = parseSdp(sdp);
    const video = parsedSdp.msections.find(msection => msection.type === 'video');

    let opusFramesPerPacket = session.startRequest.audio.packet_time / 20;

    const vs = createCameraStreamSender(console, session.vconfig, session.videoReturn,
        session.videossrc, session.startRequest.video.pt,
        session.prepareRequest.video.port, session.prepareRequest.targetAddress,
        session.startRequest.video.rtcp_interval,
        {
            maxPacketSize: session.startRequest.video.mtu,
            ...getSpsPps(video),
        });
    videoSender = vs.sendRtp;
    vs.sendRtcp();
    const as = createCameraStreamSender(console, session.aconfig, session.audioReturn,
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
    audioSender = as.sendRtp;
    as.sendRtcp();

    if (rtspClient) {
        waitForFirstVideoRtcp(console, session).then(async () => {
            try {
                await rtspClient.play();
                await rtspClient.readLoop();
            }
            finally {
                cleanup();
            }
        });
    }

    return sdp;
}
