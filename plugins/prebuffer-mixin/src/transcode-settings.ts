import sdk, { MixinProvider, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface } from "@scrypted/sdk";
import { RebroadcastPlugin } from "./main";
const { deviceManager } = sdk;

export const TRANSCODE_MIXIN_PROVIDER_NATIVE_ID = 'transcode';
export const REBROADCAST_MIXIN_INTERFACE_TOKEN = 'mixin:@scrypted/prebuffer-mixin';

export function getTranscodeMixinProviderId() {
    if (!deviceManager.getNativeIds().includes(TRANSCODE_MIXIN_PROVIDER_NATIVE_ID))
        return;
    const transcodeMixin = deviceManager.getDeviceState(TRANSCODE_MIXIN_PROVIDER_NATIVE_ID);
    return transcodeMixin?.id;
}

export class TranscodeMixinProvider extends ScryptedDeviceBase implements MixinProvider {
    constructor(public plugin: RebroadcastPlugin) {
        super(TRANSCODE_MIXIN_PROVIDER_NATIVE_ID);
    }

    async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
        if (!interfaces.includes(REBROADCAST_MIXIN_INTERFACE_TOKEN))
            return;
        return [
            ScryptedInterface.Settings,
        ];
    }

    invalidateSettings(id: string) {
        process.nextTick(() =>this.plugin.currentMixins.get(id)?.onDeviceEvent(ScryptedInterface.Settings, undefined));
    }

    async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any; }): Promise<any> {
        this.invalidateSettings(mixinDeviceState.id);
        return mixinDevice;
    }

    async releaseMixin(id: string, mixinDevice: any): Promise<void> {
        this.invalidateSettings(id);
    }
}
