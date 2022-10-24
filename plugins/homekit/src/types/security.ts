import { SecuritySystem, SecuritySystemMode, SecuritySystemObstruction, ScryptedDevice, ScryptedDeviceType, ScryptedInterface } from '@scrypted/sdk';
import { addSupportedType, bindCharacteristic, DummyDevice } from '../common';
import { Characteristic, CharacteristicEventTypes, CharacteristicSetCallback, CharacteristicValue, Service } from '../hap';
import { makeAccessory } from './common';
import type { HomeKitPlugin } from "../main";

addSupportedType({
    type: ScryptedDeviceType.SecuritySystem,
    probe(device: DummyDevice) {
        if (!device.interfaces.includes(ScryptedInterface.SecuritySystem))
            return false;
        return true;
    },
    getAccessory: async (device: ScryptedDevice & SecuritySystem, homekitPlugin: HomeKitPlugin) => {
        const accessory = makeAccessory(device, homekitPlugin);
        const service = accessory.addService(Service.SecuritySystem, device.name);
        service.setPrimaryService();

        // Set available modes based on plugin
        function systemStates(supportedModes: Array<SecuritySystemMode>): number[] {
            let modes = [Characteristic.SecuritySystemTargetState.DISARM]
            if (!supportedModes)
                return modes;

            if (supportedModes.includes(SecuritySystemMode.HomeArmed)) modes.push(Characteristic.SecuritySystemTargetState.STAY_ARM);
            if (supportedModes.includes(SecuritySystemMode.AwayArmed)) modes.push(Characteristic.SecuritySystemTargetState.AWAY_ARM);
            if (supportedModes.includes(SecuritySystemMode.NightArmed)) modes.push(Characteristic.SecuritySystemTargetState.NIGHT_ARM);

            return modes;
        }
        service.getCharacteristic(Characteristic.SecuritySystemTargetState)
        .setProps({validValues: systemStates(device.securitySystemState?.supportedModes)});

        function toCurrentState(mode: SecuritySystemMode, triggered: boolean) {
            if (!!triggered)
                return Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED;

            switch(mode) {
                case SecuritySystemMode.AwayArmed:
                    return Characteristic.SecuritySystemCurrentState.AWAY_ARM;
                case SecuritySystemMode.HomeArmed:
                    return Characteristic.SecuritySystemCurrentState.STAY_ARM;
                case SecuritySystemMode.NightArmed:
                    return Characteristic.SecuritySystemCurrentState.NIGHT_ARM;
            }

            return Characteristic.SecuritySystemCurrentState.DISARMED;
        }
        
        function toTargetState(mode: SecuritySystemMode) {
            switch(mode) {
                case SecuritySystemMode.AwayArmed:
                    return Characteristic.SecuritySystemTargetState.AWAY_ARM;
                case SecuritySystemMode.HomeArmed:
                    return Characteristic.SecuritySystemTargetState.STAY_ARM;
                case SecuritySystemMode.NightArmed:
                    return Characteristic.SecuritySystemTargetState.NIGHT_ARM;
            }
            return Characteristic.SecuritySystemTargetState.DISARM;
        }

        function fromTargetState(state: number ) {
            switch(state) {
                case Characteristic.SecuritySystemTargetState.STAY_ARM:
                    return SecuritySystemMode.HomeArmed;
                case Characteristic.SecuritySystemTargetState.AWAY_ARM:
                    return SecuritySystemMode.AwayArmed;
                case Characteristic.SecuritySystemTargetState.NIGHT_ARM:
                    return SecuritySystemMode.NightArmed;
            }
            return SecuritySystemMode.Disarmed;
        }

        bindCharacteristic(device, ScryptedInterface.SecuritySystem, service, Characteristic.SecuritySystemCurrentState,
            () => toCurrentState(device.securitySystemState?.mode, device.securitySystemState?.triggered));
        
        bindCharacteristic(device, ScryptedInterface.SecuritySystem, service, Characteristic.SecuritySystemTargetState,
            () => toTargetState(device.securitySystemState?.mode));

        service.getCharacteristic(Characteristic.SecuritySystemTargetState)
        .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
            callback();
            const targetValue = fromTargetState(value as number);
            if (targetValue === SecuritySystemMode.Disarmed)
                device.disarmSecuritySystem();
            else
                device.armSecuritySystem(targetValue);
        })

        bindCharacteristic(device, ScryptedInterface.SecuritySystem, service, Characteristic.SecuritySystemAlarmType,
            () => !!device.securitySystemState?.triggered);

        return accessory;
    },
});
