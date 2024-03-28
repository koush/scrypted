import { HttpFetchOptions } from '@scrypted/common/src/http-auth-fetch';
import { Readable } from 'stream';
import { Destroyable } from '../../rtsp/src/rtsp';

export interface HikvisionCameraStreamSetup {
    videoCodecType: string;
    audioCodecType: string;
}

export interface HikvisionAPI {

    request(urlOrOptions: string | URL | HttpFetchOptions<Readable>, body?: Readable): Promise<any>;
    reboot(): Promise<any>;
    getDeviceInfo(): Promise<any>;
    checkTwoWayAudio(): Promise<boolean>;
    checkDeviceModel(): Promise<string>;
    checkIsOldModel(): Promise<boolean>;
    checkStreamSetup(channel: string, isOld: boolean): Promise<HikvisionCameraStreamSetup>;
    jpegSnapshot(channel: string, timeout: number): Promise<Buffer>;
    listenEvents(): Promise<Destroyable>;
}