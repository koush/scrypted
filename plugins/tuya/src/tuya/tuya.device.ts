import { TuyaDeviceStatus, TuyaDeviceConfig as TuyaDeviceConfig } from "./tuya.const";

export namespace TuyaDevice {
    export function hasLightSwitch(camera: TuyaDeviceConfig): boolean {
        return getLightSwitchStatus(camera) !== undefined;
    }

    export function getLightSwitchStatus(camera: TuyaDeviceConfig): TuyaDeviceStatus | undefined {
        const lightStatusCode = [
            'floodlight_switch',    // Devices with floodlight switch
        ];

        return camera.status.find(element => lightStatusCode.includes(element.code));
    }

    export function hasStatusIndicator(camera: TuyaDeviceConfig): boolean {
        return getStatusIndicator(camera) !== undefined;
    }

    export function getStatusIndicator(camera: TuyaDeviceConfig): TuyaDeviceStatus | undefined {
        return camera.status.find(element => element.code === 'basic_indicator');
    }

    export function isDoorbell(camera: TuyaDeviceConfig): boolean {
        return false;
    }
}