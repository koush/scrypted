import { EventEmitter } from "stream"
import { TuyaCloud } from "./cloud"
import { TuyaDeviceStatus, ProtectTuyaDeviceStatus, ProtectTuyaDeviceState, RTSPToken, TuyaDeviceInterface } from "./tuya.const";

export namespace TuyaDevice {
    export function hasLightSwitch(camera: ProtectTuyaDeviceState): boolean {
        return getLightSwitchStatus(camera) !== undefined;
    }

    export function getLightSwitchStatus(camera: ProtectTuyaDeviceState): ProtectTuyaDeviceStatus | undefined {
        const lightStatusCode = [
            'floodlight_switch',    // Devices with floodlight switch
        ];

        return camera.status.find(element => lightStatusCode.includes(element.code));
    }


    export function hasStatusIndicator(camera: ProtectTuyaDeviceState): boolean {
        return getStatusIndicator(camera) !== undefined;
    }

    export function getStatusIndicator(camera: ProtectTuyaDeviceState): ProtectTuyaDeviceStatus | undefined {
        return camera.status.find(element => element.code === 'basic_indicator');
    }

    export function isDoorbell(camera: ProtectTuyaDeviceState): boolean {
        return false;
    }
}