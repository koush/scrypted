import { ScryptedDevice, ScryptedDeviceType, ScryptedInterface, AirPurifierStatus, AirPurifierMode, AirPurifier, FilterMaintenance } from '@scrypted/sdk';
import { addSupportedType, bindCharacteristic, DummyDevice, } from '../common';
import { Characteristic, CharacteristicEventTypes, CharacteristicSetCallback, CharacteristicValue, Service } from '../hap';
import { makeAccessory } from './common';
import type { HomeKitPlugin } from "../main";

addSupportedType({
    type: ScryptedDeviceType.AirPurifier,
    probe(device: DummyDevice): boolean {
        return device.interfaces.includes(ScryptedInterface.AirPurifier);
    },
    getAccessory: async (device: ScryptedDevice & AirPurifier & FilterMaintenance, homekitPlugin: HomeKitPlugin) => {
        const accessory = makeAccessory(device, homekitPlugin);

        const service = accessory.addService(Service.AirPurifier, device.name);
        const nightModeService = accessory.addService(Service.Switch, `${device.name} Night Mode`)

        /* On/Off AND mode toggle */
        bindCharacteristic(device, ScryptedInterface.AirPurifier, service, Characteristic.Active,
            () => {
                switch(device.airPurifierState.status) {
                    case AirPurifierStatus.Active:
                        return Characteristic.Active.ACTIVE;
                    case AirPurifierStatus.ActiveNightMode:
                        return Characteristic.Active.ACTIVE;
                }
                return Characteristic.Active.INACTIVE;
            });

        service.getCharacteristic(Characteristic.Active)
        .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
            callback();
            device.setAirPurifierState({
                status: (value as boolean) ? AirPurifierStatus.Active : AirPurifierStatus.Inactive,
            })
        });

        /* Current State */
        bindCharacteristic(device, ScryptedInterface.AirPurifier, service, Characteristic.CurrentAirPurifierState,
            () => {
                switch (device.airPurifierState.status) {
                    case AirPurifierStatus.Inactive:
                        return Characteristic.CurrentAirPurifierState.INACTIVE;
                    case AirPurifierStatus.Idle:
                        return Characteristic.CurrentAirPurifierState.IDLE;
                }
                return Characteristic.CurrentAirPurifierState.PURIFYING_AIR;
            });

        /* Fan Speed */
        bindCharacteristic(device, ScryptedInterface.AirPurifier, service, Characteristic.RotationSpeed,
            () => device.airPurifierState.speed);

        service.getCharacteristic(Characteristic.RotationSpeed)
        .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
            callback();
            device.setAirPurifierState({
                speed: value as number,
            })
        })
        
        /* i.e. Mode: Manual/Auto slider */
        bindCharacteristic(device, ScryptedInterface.AirPurifier, service, Characteristic.TargetAirPurifierState,
            () => {
                if (device.airPurifierState.mode == AirPurifierMode.Automatic)
                    return Characteristic.TargetAirPurifierState.AUTO;
                return Characteristic.TargetAirPurifierState.MANUAL;
            });

        service.getCharacteristic(Characteristic.TargetAirPurifierState)
        .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
            callback();
            device.setAirPurifierState({
                mode: value === Characteristic.TargetAirPurifierState.AUTO ? AirPurifierMode.Automatic : AirPurifierMode.Manual,
            })
        });

        /* LockPhysicalControls i.e. "Child Lock: Unlocked/Locked" */ 
        bindCharacteristic(device, ScryptedInterface.AirPurifier, service, Characteristic.LockPhysicalControls,
            () => !!device.airPurifierState.lockPhysicalControls);

        service.getCharacteristic(Characteristic.LockPhysicalControls)
        .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
            callback();
            device.setAirPurifierState({
                lockPhysicalControls: (value as boolean),
            })
        })

        /* Night mode switch */
        bindCharacteristic(device, ScryptedInterface.AirPurifier, nightModeService, Characteristic.On,
            () => !!(device.airPurifierState.status === AirPurifierStatus.ActiveNightMode));

        nightModeService.getCharacteristic(Characteristic.On)
        .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
            callback();
            device.setAirPurifierState({
                status: value ? AirPurifierStatus.ActiveNightMode : AirPurifierStatus.Active,
            })
        })

        /* Optional: Filter Maintenance Service */
        if (device.interfaces.includes(ScryptedInterface.FilterMaintenance)) {
            const filterMaintenanceService = accessory.addService(Service.FilterMaintenance, device.name);

            bindCharacteristic(device, ScryptedInterface.FilterMaintenance, filterMaintenanceService, Characteristic.FilterLifeLevel,
                () => device.filterLifeLevel)
    
            bindCharacteristic(device, ScryptedInterface.FilterMaintenance, filterMaintenanceService, Characteristic.FilterChangeIndication,
                () => {
                    if (device.filterChangeIndication)
                        return Characteristic.FilterChangeIndication.CHANGE_FILTER;
                    return Characteristic.FilterChangeIndication.FILTER_OK;
                })
        }

        return accessory;
    }
});
