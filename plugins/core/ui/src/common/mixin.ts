import { timeoutPromise } from "@scrypted/common/src/promise-utils";
import { MixinProvider, ScryptedDevice, ScryptedDeviceType, ScryptedInterface, SystemManager } from "@scrypted/types";

export async function setMixin(systemManager: SystemManager, device: ScryptedDevice, mixinId: string, enabled: boolean) {
    const plugins = await systemManager.getComponent(
        "plugins"
    );
    let mixins = (device.mixins || []).slice();
    if (enabled) {
        mixins.push(mixinId);
    } else {
        mixins = mixins.filter((id: string) => mixinId !== id);
    }

    plugins.setMixins(device.id, mixins);
}

export function getAllDevices<T>(systemManager: SystemManager) {
    return Object.keys(systemManager.getSystemState()).map(id => systemManager.getDeviceById(id) as T & ScryptedDevice).filter(device => !!device);
}

export async function getDeviceAvailableMixins(systemManager: SystemManager, device: ScryptedDevice): Promise<(ScryptedDevice & MixinProvider)[]> {
    const results = await Promise.all(getAllDevices<MixinProvider>(systemManager).map(async (check) => {
        try {
            if (check.interfaces.includes(ScryptedInterface.MixinProvider)) {
                const canMixin = await timeoutPromise(5000, check.canMixin(device.type, device.interfaces));
                if (canMixin)
                    return check;
            }
        }
        catch (e) {
            console.warn(check.name, 'canMixin error', e)
        }
    }));

    return results.filter(result => !!result);
}

export interface MixinProviderResult {
    id: string;
    name: string;
    type: ScryptedDeviceType;
    enabled: boolean;
}

export async function getMixinProviderAvailableDevices(systemManager: SystemManager, mixinProvider: ScryptedDevice & MixinProvider): Promise<MixinProviderResult[]> {
    const devices = getAllDevices(systemManager);

    const checks = await Promise.all(
        devices.map(async (device) => {
            try {
                if (device.mixins?.includes(mixinProvider.id) || (await mixinProvider.canMixin(device.type, device.interfaces)))
                    return device;
            }
            catch (e) {
            }
        })
    );
    const found = checks.filter((check) => !!check).sort((d1, d2) => d1.id < d2.id ? -1 : 1);

    return found.map((device) => ({
        id: device.id,
        name: device.name,
        type: device.type,
        enabled: device.mixins?.includes(mixinProvider.id),
    }));
}
