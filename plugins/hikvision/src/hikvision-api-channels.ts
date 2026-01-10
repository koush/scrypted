import { HttpFetchOptions } from '@scrypted/common/src/http-auth-fetch';
import { MediaStreamConfiguration, MediaStreamOptions, PanTiltZoomCommand } from '@scrypted/sdk';
import { Readable } from 'stream';
import { Destroyable } from '../../rtsp/src/rtsp';
import { PtzPresetsRoot, TextOverlayRoot, VideoOverlayRoot } from './hikvision-overlay';
import { SupplementLightRoot } from './hikvision-xml-types';
import { PtzCapabilitiesRoot } from './hikvision-api-capabilities';

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

    getSupplementLightCapabilities(): Promise<{json: SupplementLightRoot; xml: any }>;
    getSupplementLightState(): Promise<{ on: boolean }>;
    setSupplementLight(params: { on?: boolean; output?: 'auto' | 'white' | 'ir'; brightness?: number; whiteBrightness?: number; irBrightness?: number; mode?: 'auto' | 'manual'; smartMode?: 'auto' | 'manual'; smartSupplementLightEnabled?: boolean; }): Promise<void>;

    getAlarmCapabilities(): Promise<{ json: any; xml: string }>;
    getAlarm(port: string): Promise<{ json: any; xml: string }>;
    setAlarm(isOn: boolean): Promise<{ json: any; xml: string }>;
    getAlarmLinkageCapabilities(): Promise<{ supportsBeep: boolean; supportsWhiteLight: boolean; supportsIO: boolean }>;
    getAlarmLinkages(): Promise<{ beep: boolean; whiteLight: boolean; io: boolean; whiteLightDuration: number }>;
    setAlarmLinkages(linkages: { beep: boolean; whiteLight: boolean; io: boolean; whiteLightDuration: number }): Promise<void>;
    
    getAudioAlarmCapabilities(): Promise<{
        supported: boolean;
        audioTypes: { id: number; description: string }[];
        volumeRange: { min: number; max: number };
        alarmTimesRange: { min: number; max: number };
    } | null>;
    getAudioAlarmSettings(): Promise<{ audioID: number; audioVolume: number; alarmTimes: number } | null>;
    setAudioAlarmSettings(settings: { audioID: number; audioVolume: number; alarmTimes: number }): Promise<void>;
    
    getWhiteLightAlarmCapabilities(): Promise<{
        supported: boolean;
        durationRange: { min: number; max: number };
        frequencyOptions: string[];
    } | null>;
    getWhiteLightAlarmSettings(): Promise<{ durationTime: number; frequency: string } | null>;
    setWhiteLightAlarmSettings(settings: { durationTime: number; frequency: string }): Promise<void>;

    getPtzCapabilities(): Promise<{ json: PtzCapabilitiesRoot; xml: string }>;
    ptzCommand(command: PanTiltZoomCommand): Promise<any>;
    getPresets(): Promise<{
        json: PtzPresetsRoot;
        xml: any;
    }>;
}
