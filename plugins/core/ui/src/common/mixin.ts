import { MixinProvider, ScryptedDevice, ScryptedInterface, SystemManager } from "@scrypted/sdk/types";

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

export async function getDeviceAvailableMixins(systemManager: SystemManager, device: ScryptedDevice): Promise<(ScryptedDevice & MixinProvider)[]> {
    const ret = [];
    const state = systemManager.getSystemState();
    for (const id of Object.keys(state)) {
        const check = systemManager.getDeviceById<MixinProvider>(id);
        if (check.interfaces.includes(ScryptedInterface.MixinProvider)) {
            try {
                if (await check.canMixin(device.type, device.interfaces)) {
                    ret.push(check);
                }
            }
            catch (e) {
                console.error("mixin check error", id, e);
            }
        }
    }

    return ret;
}

export async function getDeviceMixins(systemManager: SystemManager, device: ScryptedDevice) {
    const mixins = (device.mixins || []).slice();
    return mixins;
}
