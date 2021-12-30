import { ScryptedDeviceType, ScryptedInterface } from "@scrypted/sdk";

export function canMixin(type: ScryptedDeviceType, interfaces: string[]): boolean {
    const set = new Set(interfaces);
    set.delete(ScryptedInterface.ObjectDetection);
    set.delete(ScryptedInterface.DeviceDiscovery);
    set.delete(ScryptedInterface.DeviceCreator);
    set.delete(ScryptedInterface.DeviceProvider);
    set.delete(ScryptedInterface.MixinProvider);
    set.delete(ScryptedInterface.PushHandler);
    set.delete(ScryptedInterface.EngineIOHandler);
    set.delete(ScryptedInterface.HttpRequestHandler);
    set.delete(ScryptedInterface.Settings);
    return !!set.size;
}
