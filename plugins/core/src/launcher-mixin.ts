import { DeviceState, MixinProvider, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface } from "@scrypted/sdk";
import { typeToIcon } from "../ui/src/components/helpers";

export class LauncherMixin extends ScryptedDeviceBase implements MixinProvider {
    async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
        if (interfaces.includes("@scrypted/launcher-ignore"))
            return;
        return [
            ScryptedInterface.LauncherApplication,
        ];
    }

    async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: DeviceState): Promise<any> {
        mixinDeviceState.applicationInfo = {
            icon: 'fa ' + typeToIcon(mixinDeviceState.type),
            href: '/endpoint/@scrypted/core/public/#/device/' + mixinDeviceState.id,
        }
        return mixinDevice;
    }

    async releaseMixin(id: string, mixinDevice: any): Promise<void> {

    }
}
