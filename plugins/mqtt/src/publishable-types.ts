import { ScryptedDeviceType, ScryptedInterface } from "@scrypted/sdk";

export function isPublishable(type: ScryptedDeviceType, interfaces: string[]): boolean {
    switch (type) {
        case ScryptedDeviceType.API:
        case ScryptedDeviceType.Builtin:
        case ScryptedDeviceType.Internal:
        case ScryptedDeviceType.DataSource:
        case ScryptedDeviceType.Unknown:
            return false;
    }
    const set = new Set(interfaces);
    set.delete(ScryptedInterface.ObjectDetection);
    set.delete(ScryptedInterface.DeviceProvider);
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
    set.delete(ScryptedInterface.ScryptedSystemDevice);
    set.delete(ScryptedInterface.ScryptedDeviceCreator);
    set.delete(ScryptedInterface.ScryptedUser);
    set.delete(ScryptedInterface.Camera);
    set.delete(ScryptedInterface.RTCSignalingChannel);
    set.delete(ScryptedInterface.StreamService);
    set.delete(ScryptedInterface.Settings);
    set.delete(ScryptedInterface.Notifier);
    return !!set.size;
}
