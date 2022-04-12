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
    rtpSink?: HomeKitRtpSink;
    tryReconfigureBitrate?: (reason: string, bitrate: number) => void;
    mediaStreamOptions?: ResponseMediaStreamOptions;
}

export type KillCameraStreamingSession = () => void;
