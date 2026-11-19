import { Lock, ScryptedDevice, ScryptedDeviceType, ScryptedInterface } from '@scrypted/sdk';
import { addSupportedType, DummyDevice,  } from '../common';
import { makeAccessory } from './common';
import type { HomeKitPlugin } from "../main";
import { getService as getLockService } from './lock-base';

addSupportedType({
    type: ScryptedDeviceType.Lock,
    probe(device: DummyDevice) {
        return device.interfaces.includes(ScryptedInterface.Lock);
    },
    getAccessory: async (device: ScryptedDevice & Lock, homekitPlugin: HomeKitPlugin) => {
        const accessory = makeAccessory(device, homekitPlugin);
        getLockService(device, accessory);
        return accessory;
    }
});
