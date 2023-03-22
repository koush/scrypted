import { ScryptedDeviceType, ScryptedInterface } from "@scrypted/sdk";

export function isPublishable(type: ScryptedDeviceType, interfaces: string[]): boolean {
    switch (type) {
        case ScryptedDeviceType.API:
        case ScryptedDeviceType.Builtin:
        case ScryptedDeviceType.DataSource:
        case ScryptedDeviceType.Unknown:
            return false;
    }
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
    set.delete(ScryptedInterface.Readme);
    set.delete(ScryptedInterface.BufferConverter);
    set.delete(ScryptedInterface.ScryptedPlugin);
    set.delete(ScryptedInterface.OauthClient);
    set.delete(ScryptedInterface.OauthClient);
    set.delete(ScryptedInterface.LauncherApplication);
    return !!set.size;
}
