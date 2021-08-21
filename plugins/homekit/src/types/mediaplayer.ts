
import { VideoCamera, MediaPlayer, MediaPlayerState, ScryptedDevice, ScryptedDeviceType, ScryptedInterface } from '@scrypted/sdk'
import { addSupportedType, DummyDevice } from '../common'
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
    getAccessory: (device: ScryptedDevice & MediaPlayer) => {
        const accessory = makeAccessory(device);
        accessory.category = Categories.TELEVISION;
        const service = accessory.addService(Service.Television, "Television", "Television");
        // service.setPrimaryService(true);

        let active = false;
        let activeIdentifier = 0;
        const allowedIdentifiers = new Set<string>();
        service.getCharacteristic(Characteristic.Active)
            .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
                active = value === Characteristic.Active.ACTIVE;
                if (!active)
                    device.stop();
                callback();
            })
            .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
                try {
                    if (active) {
                        callback(null, Characteristic.Active.ACTIVE);
                        return;
                    }
                    const mediaStatus = await device.getMediaStatus();
                    if (!mediaStatus || mediaStatus.mediaPlayerState === MediaPlayerState.Idle) {
                        callback(null, Characteristic.Active.INACTIVE);
                        return;
                    }
                    active = true;
                    callback(null, Characteristic.Active.ACTIVE);
                }
                catch (e) {
                    callback(e);
                }
            });

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


        service.setCharacteristic(Characteristic.ConfiguredName, device.name);

        service.getCharacteristic(Characteristic.RemoteKey)
            .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
                callback();
            });

        service.setCharacteristic(Characteristic.SleepDiscoveryMode, Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE);

        const speaker = accessory.addService(Service.TelevisionSpeaker);
        speaker.setCharacteristic(Characteristic.Active, Characteristic.Active.ACTIVE)

        speaker.getCharacteristic(Characteristic.Mute)
            .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
                callback();
            })
            .on(CharacteristicEventTypes.GET, async (callback: NodeCallback<CharacteristicValue>) => {
                callback(null, false);
            });



        const idle = accessory.addService(Service.InputSource, 'idle', 'Idle');
        idle.setCharacteristic(Characteristic.Identifier, 0)
            .setCharacteristic(Characteristic.ConfiguredName, 'Idle')
            .setCharacteristic(Characteristic.IsConfigured, Characteristic.IsConfigured.CONFIGURED)
            .setCharacteristic(Characteristic.InputSourceType, Characteristic.InputSourceType.APPLICATION);
        service.addLinkedService(idle);


        for (const id of Object.keys(systemManager.getSystemState())) {
            const check = systemManager.getDeviceById(id);
            if (check.type !== ScryptedDeviceType.Camera)
                continue;

            allowedIdentifiers.add(check.id);

            const input = accessory.addService(Service.InputSource, `input-${check.id}`, check.name);
            input.setCharacteristic(Characteristic.Identifier, check.id)
                .setCharacteristic(Characteristic.ConfiguredName, check.name)
                .setCharacteristic(Characteristic.IsConfigured, Characteristic.IsConfigured.CONFIGURED)
                .setCharacteristic(Characteristic.InputSourceType, Characteristic.InputSourceType.APPLICATION);

            service.addLinkedService(input);
        }

        return accessory;
    }
});
