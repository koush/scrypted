import { getH264DecoderArgs, getH264EncoderArgs } from "@scrypted/common/src/ffmpeg-hardware-acceleration";
import { StorageSettings } from "@scrypted/common/src/settings";
import { MixinDeviceBase, ScryptedDeviceBase } from "@scrypted/sdk";

export type WebRTCStorageSettingsKeys = "useSdp";

export function createWebRTCStorageSettings(device: MixinDeviceBase<any> | ScryptedDeviceBase): StorageSettings<WebRTCStorageSettingsKeys> {
    return new StorageSettings(device, {
        useSdp: {
            title: 'Use SDP/UDP instead of RTSP',
            description: 'Experimental',
            type: 'boolean',
            defaultValue: true,
            // hide: true,
        },
    });
}