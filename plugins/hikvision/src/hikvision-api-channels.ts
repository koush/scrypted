import { HttpFetchOptions } from '@scrypted/common/src/http-auth-fetch';
import { MediaStreamConfiguration, MediaStreamOptions } from '@scrypted/sdk';
import { Readable } from 'stream';
import { Destroyable } from '../../rtsp/src/rtsp';
import { TextOverlayRoot, VideoOverlayRoot } from './hikvision-overlay';
import { SupplementLightRoot } from './hikvision-xml-types';

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
    putVcaResource(channel: string, resource: 'smart' | 'facesnap' | 'close'): Promise<boolean>;
    getCodecs(camNumber: string): Promise<MediaStreamOptions[]>;
    configureCodecs(camNumber: string, channelNumber: string, options: MediaStreamOptions): Promise<MediaStreamConfiguration>;

    getOverlay(): Promise<{
        json: VideoOverlayRoot;
        xml: any;
    }>;
    getOverlayText(overlayId: string): Promise<{
        json: TextOverlayRoot;
        xml: any;
    }>;
    updateOverlayText(overlayId: string, entry: TextOverlayRoot): Promise<void>;

    getSupplementLight(): Promise<{
        json: SupplementLightRoot; 
        xml: any 
    }>;

    setSupplementLight(params: { on?: boolean, brightness?: number, mode?: 'auto' | 'manual' }): Promise<void>;
}
