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

function getAllDevices<T>(systemManager: SystemManager) {
    return Object.keys(systemManager.getSystemState()).map(id => systemManager.getDeviceById<T>(id)).filter(device => !!device);
}

export async function getDeviceAvailableMixins(systemManager: SystemManager, device: ScryptedDevice): Promise<(ScryptedDevice & MixinProvider)[]> {
    const results = await Promise.all(getAllDevices<MixinProvider>(systemManager).map(async (check) => {
        try {
            if (check.interfaces.includes(ScryptedInterface.MixinProvider)) {
                if (await check.canMixin(device.type, device.interfaces))
                    return check;
            }
        }
        catch (e) {
            console.error("mixin check error", check.id, e);
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

export async function getDeviceMixins(systemManager: SystemManager, device: ScryptedDevice) {
    const mixins = (device.mixins || []).slice();
    return mixins;
}
