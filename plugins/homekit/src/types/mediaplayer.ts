
import { VideoCamera, MediaPlayer, MediaPlayerState, ScryptedDevice, ScryptedDeviceType, ScryptedInterface } from '@scrypted/sdk'
import { addSupportedType, bindCharacteristic, DummyDevice } from '../common'
import { Categories, Characteristic, CharacteristicEventTypes, CharacteristicSetCallback, CharacteristicValue, NodeCallback, Service } from '../hap';
import { makeAccessory } from './common';
import sdk from '@scrypted/sdk';
const { systemManager } = sdk;

addSupportedType({
    // noBridge: true,
    type: ScryptedDeviceType.Display,
    probe(device: DummyDevice) {
        return device.interfaces.includes(ScryptedInterface.MediaPlayer);
    },
    getAccessory: async (device: ScryptedDevice & MediaPlayer) => {
        const accessory = makeAccessory(device);
        accessory.category = Categories.TELEVISION;
        const service = accessory.addService(Service.Television, "Television", "Television");
        // service.setPrimaryService(true);

        let activeIdentifier = 0;
        const allowedIdentifiers = new Set<string>();
        service.getCharacteristic(Characteristic.Active)
            .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
                if (value !== Characteristic.Active.ACTIVE)
                    device.stop();
                callback();
            });

            let active = false;
        bindCharacteristic(device, ScryptedInterface.MediaPlayer, service, Characteristic.Active,
            () => {
                // trigger an actual fetch here but return something cached immediately.
                (async() => {
                    const mediaStatus = await device.getMediaStatus();
                    active = mediaStatus && mediaStatus.mediaPlayerState !== MediaPlayerState.Idle;
                    service.updateCharacteristic(Characteristic.Active, active ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE);
                })();
                return active ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE;
            })

        service.getCharacteristic(Characteristic.ActiveIdentifier)
            .on(CharacteristicEventTypes.SET, async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
                activeIdentifier = value as number;
                if (activeIdentifier === 0) {
                    callback();
                    device.stop();
                    return;
                }

                const id = activeIdentifier.toString();
                if (!allowedIdentifiers.has(id)) {
                    callback(new Error('unknown ActiveIdentifier'));
                    return;
                }

                try {
                    const input = systemManager.getDeviceById(id) as ScryptedDevice & VideoCamera;
                    const media = await input.getVideoStream();
                    device.load(media, null);
                    callback();
                }
                catch (e) {
                    callback(e);
                }
            })
            .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
                callback(null, activeIdentifier);
            });

        service.updateCharacteristic(Characteristic.ConfiguredName, device.name);

        service.getCharacteristic(Characteristic.RemoteKey)
            .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
                callback();
            });

        service.updateCharacteristic(Characteristic.SleepDiscoveryMode, Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);

        const speaker = accessory.addService(Service.TelevisionSpeaker);
        speaker.updateCharacteristic(Characteristic.Active, Characteristic.Active.ACTIVE)

        speaker.getCharacteristic(Characteristic.Mute)
            .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
                callback();
            })
            .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
                callback(null, false);
            });

        const idle = accessory.addService(Service.InputSource, 'idle', 'Idle');
        idle.updateCharacteristic(Characteristic.Identifier, 0)
            .updateCharacteristic(Characteristic.ConfiguredName, 'Idle')
            .updateCharacteristic(Characteristic.IsConfigured, Characteristic.IsConfigured.CONFIGURED)
            .updateCharacteristic(Characteristic.InputSourceType, Characteristic.InputSourceType.APPLICATION);
        service.addLinkedService(idle);

        for (const id of Object.keys(systemManager.getSystemState())) {
            const check = systemManager.getDeviceById(id);
            if (check.type !== ScryptedDeviceType.Camera)
                continue;

            allowedIdentifiers.add(check.id);

            const input = accessory.addService(Service.InputSource, check.name, `input-${check.id}`);
            input.updateCharacteristic(Characteristic.Identifier, check.id)
                .updateCharacteristic(Characteristic.ConfiguredName, check.name)
                .updateCharacteristic(Characteristic.IsConfigured, Characteristic.IsConfigured.CONFIGURED)
                .updateCharacteristic(Characteristic.InputSourceType, Characteristic.InputSourceType.APPLICATION);

            service.addLinkedService(input);
        }

        return accessory;
    }
});
