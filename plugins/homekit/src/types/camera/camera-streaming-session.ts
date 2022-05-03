import { ResponseMediaStreamOptions } from '@scrypted/sdk';
import { ChildProcess } from 'child_process';
import dgram from 'dgram';
import { Config } from '../../../../../external/werift/packages/rtp/src/srtp/session';
import { PrepareStreamRequest, StartStreamRequest } from '../../hap';
import { HomeKitRtpSink } from '../../rtp/rtp-ffmpeg-input';

export interface CameraStreamingSession {
    killed: boolean;
    prepareRequest: PrepareStreamRequest;
    startRequest: StartStreamRequest;
    videossrc: number;
    audiossrc: number;
    aconfig: Config;
    vconfig: Config;
    videoProcess: ChildProcess;
    audioProcess: ChildProcess;
    videoReturn: dgram.Socket;
    audioReturn: dgram.Socket;
    videoReturnRtcpReady: Promise<any>;
    rtpSink?: HomeKitRtpSink;
    tryReconfigureBitrate?: (reason: string, bitrate: number) => void;
    mediaStreamOptions?: ResponseMediaStreamOptions;
}

export type KillCameraStreamingSession = () => void;

// this is a workaround for a bug seen in:
// ios 15.5 beta 1
// ios 15.5 beta 2
// ios 15.5 beta 4 (3 seemed fine)
// macos 12.3 beta 1
export async function waitForFirstVideoRtcp(console: Console, session: CameraStreamingSession) {
    console.log('Waiting for video RTCP packet before sending video.');
    await session.videoReturnRtcpReady;
    console.log('Received first video RTCP packet.');
}