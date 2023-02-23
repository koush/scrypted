import sdk, { MixinProvider, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting, Settings, SettingValue } from "@scrypted/sdk";
import { RebroadcastPlugin } from "./main";
import { REBROADCAST_MIXIN_INTERFACE_TOKEN } from "./rebroadcast-mixin-token";
const { deviceManager } = sdk;

export const TRANSCODE_MIXIN_PROVIDER_NATIVE_ID = 'transcode';

export function getTranscodeMixinProviderId() {
    if (!deviceManager.getNativeIds().includes(TRANSCODE_MIXIN_PROVIDER_NATIVE_ID))
        return;
    const transcodeMixin = deviceManager.getDeviceState(TRANSCODE_MIXIN_PROVIDER_NATIVE_ID);
    return transcodeMixin?.id;
}

export class TranscodeMixinProvider extends ScryptedDeviceBase implements MixinProvider, Settings {
    constructor(public plugin: RebroadcastPlugin) {
        super(TRANSCODE_MIXIN_PROVIDER_NATIVE_ID);
    }

    getSettings(): Promise<Setting[]> {
        return this.plugin.transcodeStorageSettings.getSettings();
    }

    putSetting(key: string, value: SettingValue): Promise<void> {
        return this.plugin.transcodeStorageSettings.putSetting(key, value);
    }

    async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
        if (!interfaces.includes(REBROADCAST_MIXIN_INTERFACE_TOKEN))
            return;
        return [
            ScryptedInterface.Settings,
        ];
    }

    invalidateSettings(id: string) {
        process.nextTick(async () => {
            for (const [mixin, v] of this.plugin.currentMixins.entries()) {
                if (v.id === id)
                    mixin?.onDeviceEvent(ScryptedInterface.Settings, undefined)
            }
        });
    }

    async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any; }): Promise<any> {
        this.invalidateSettings(mixinDeviceState.id);
        return mixinDevice;
    }

    async releaseMixin(id: string, mixinDevice: any): Promise<void> {
        this.invalidateSettings(id);
    }
}
