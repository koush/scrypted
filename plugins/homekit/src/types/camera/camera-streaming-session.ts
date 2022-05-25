import type { Config } from '@koush/werift-src/packages/rtp/src/srtp/session';
import { ResponseMediaStreamOptions } from '@scrypted/sdk';
import dgram from 'dgram';
import { PrepareStreamRequest, StartStreamRequest } from '../../hap';

export interface CameraStreamingSession {
    killed: boolean;
    kill: () => void;
    killPromise: Promise<void>;
    prepareRequest: PrepareStreamRequest;
    startRequest: StartStreamRequest;
    videossrc: number;
    audiossrc: number;
    aconfig: Config;
    vconfig: Config;
    videoReturn: dgram.Socket;
    audioReturn: dgram.Socket;
    videoReturnRtcpReady: Promise<any>;
    tryReconfigureBitrate?: (reason: string, bitrate: number) => void;
    mediaStreamOptions?: ResponseMediaStreamOptions;
}

// this is a workaround for a bug seen in:
// ios 15.5 beta 1
// ios 15.5 beta 2
// ios 15.5 beta 4 (3 seemed fine)
// macos 12.3 beta 1

// bug seems resolved:
// macos 12.4

// bug is still present:
// ios 15.5 RC
export async function waitForFirstVideoRtcp(console: Console, session: CameraStreamingSession) {
    if (!session.videoReturnRtcpReady)
        return;
    console.log('Waiting for video RTCP packet before sending video.');
    await session.videoReturnRtcpReady;
    console.log('Received first video RTCP packet.');
}
