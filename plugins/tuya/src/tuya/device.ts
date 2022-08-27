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
        return getDoorbellStatus(camera) !== undefined;
    }

    export function getDoorbellStatus(camera) : TuyaDeviceStatus | undefined {
        const doorbellStatus = getStatus(camera, ['dorbell_chime']);
        return doorbellStatus?.value !== undefined ? doorbellStatus : undefined;
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

    function getStatus(camera: TuyaDeviceConfig, statusCode: string[]) : TuyaDeviceStatus | undefined {
        return camera.status.find(value => statusCode.includes(value.code));
    }
}