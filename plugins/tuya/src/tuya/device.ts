import { TuyaCloud } from "./cloud";
import { TuyaDeviceStatus, TuyaDeviceConfig as TuyaDeviceConfig } from "./const";

export namespace TuyaDevice {

    // MARK: Switch Light

    export function hasLightSwitch(camera: TuyaDeviceConfig): boolean {
        return getLightSwitchStatus(camera) !== undefined;
    }

    export function getLightSwitchStatus(camera: TuyaDeviceConfig): TuyaDeviceStatus | undefined {
        const lightStatusCode = [
            'floodlight_switch',    // Devices with floodlight switch
        ];

        return getStatus(camera, lightStatusCode);
    }

    // MARK: Status Indicator

    export function hasStatusIndicator(camera: TuyaDeviceConfig): boolean {
        return getStatusIndicator(camera) !== undefined;
    }

    export function getStatusIndicator(camera: TuyaDeviceConfig): TuyaDeviceStatus | undefined {
        return getStatus(camera, ['basic_indicator']);
    }

    // MARK: Doorbell

    export function isDoorbell(camera: TuyaDeviceConfig): boolean {
        const search = [
            'wireless_powermode',   // According to tuya, most low-powered devices are doorbells
            'doorbell_ring_exist'   // Typically, doorbells are able to add chimes. If this option is available, then most likely it is a doorbell.
            // 'doorbell_active',   // Seems to be very common even in non-doorbell config
        ];

        for (const code of search) {
            const status = camera.status.find(status => status.code == code);
            if (status?.value !== undefined) {
                return true;
            }
        }
        return false;
    }

    export function getDoorbellRing(camera: TuyaDeviceConfig): TuyaDeviceStatus {
        const ring = [
            'alarm_message',
            'doorbell_pic'
        ];
        return getStatus(camera, ring)
    }

    // MARK: Motion Detection

    export function hasMotionDetection(camera: TuyaDeviceConfig): boolean {
        const motionSwitchCodes = [
            'motion_switch',
            'pir_sensitivity'
        ]

        return getStatus(camera, motionSwitchCodes) !== undefined;
    }

    export function getMotionDetectionStatus(camera: TuyaDeviceConfig) {
        const motionDetectionCodes = [
            'movement_detect_pic'
        ];

        return getStatus(camera, motionDetectionCodes);
    }

    // Supports WebRTC

    export async function supportsWebRTC(camera: TuyaDeviceConfig, cloud: TuyaCloud) {
        const webRTConfig = await cloud.getDeviceWebRTConfig(camera);
        return webRTConfig.success && webRTConfig.result.supports_webrtc;
    }

    // Device Status

    function getStatus(camera: TuyaDeviceConfig, statusCode: string[]) : TuyaDeviceStatus | undefined {
        return camera.status.find(value => statusCode.includes(value.code));
    }
}