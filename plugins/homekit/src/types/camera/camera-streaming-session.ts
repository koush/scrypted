import { ChildProcess } from 'child_process';
import dgram from 'dgram';
import { PrepareStreamRequest, StartStreamRequest, CameraController } from '../../hap';
import { HomeKitRtpSink } from '../../rtp/rtp-ffmpeg-input';

export interface CameraStreamingSession {
    killed: boolean;
    prepareRequest: PrepareStreamRequest;
    startRequest: StartStreamRequest;
    videossrc: number;
    audiossrc: number;
    cp: ChildProcess;
    videoReturn: dgram.Socket;
    audioReturn: dgram.Socket;
    rtpSink?: HomeKitRtpSink;
    isHomeKitHub: boolean;
}

export type KillCameraStreamingSession = () => void;
