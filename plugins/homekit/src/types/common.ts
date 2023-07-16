import sdk, { AirQuality, AirQualitySensor, CO2Sensor, DeviceProvider, Fan, FanMode, NOXSensor, OnOff, PM10Sensor, PM25Sensor, ScryptedDevice, ScryptedDeviceType, ScryptedInterface, VOCSensor } from "@scrypted/sdk";
import { bindCharacteristic } from "../common";
import { Accessory, Characteristic, CharacteristicEventTypes, Service, uuid } from '../hap';
import type { HomeKitPlugin } from "../main";
import { getService as getOnOffService } from "./onoff-base";

const { deviceManager, systemManager } = sdk;

export function getSafeMdnsName(device: ScryptedDevice) {
    // Valid domains can include 0-9, a-z (case insensitive), dash, and period.
    // However, period must filtered because this is an mdns subdomain.

    // The underlying mdns advertisers also support spaces (allegedly, since it seems to work already, but I have not looked closely).

    let newName = '';
    let name = device.name || 'Scrypted';
    for (const c of name) {
        if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '-' || c === ' ') {
            newName += c
        }
    }

    if (!newName)
        newName = 'Scrypted';

    return newName;
}

export function makeAccessory(device: ScryptedDevice, homekitPlugin: HomeKitPlugin, suffix?: string): Accessory {
    const mixinStorage = deviceManager.getMixinStorage(device.id, homekitPlugin.nativeId);
    const resetId = mixinStorage.getItem('resetAccessory') || '';
    return new Accessory(getSafeMdnsName(device), uuid.generate(resetId + device.id + (suffix ? '-' + suffix : '')));
}

export function getChildDevices(device: ScryptedDevice & DeviceProvider): ScryptedDevice[] {
    const ids = Object.keys(systemManager.getSystemState());
    const allDevices = ids.map(id => systemManager.getDeviceById(id));
    return allDevices.filter(d => d.providerId == device.id);
}

export function addAirQualitySensor(device: ScryptedDevice & AirQualitySensor & PM10Sensor & PM25Sensor & VOCSensor & NOXSensor, accessory: Accessory): Service {
    if (!device.interfaces.includes(ScryptedInterface.AirQualitySensor))
        return undefined;

    function airQualityToHomekit(airQuality: AirQuality) {
        switch (airQuality) {
            case AirQuality.Excellent:
                return Characteristic.AirQuality.EXCELLENT;
            case AirQuality.Good:
                return Characteristic.AirQuality.GOOD;
            case AirQuality.Fair:
                return Characteristic.AirQuality.FAIR;
            case AirQuality.Inferior:
                return Characteristic.AirQuality.INFERIOR;
            case AirQuality.Poor:
                return Characteristic.AirQuality.POOR;
        }
        return Characteristic.AirQuality.UNKNOWN;
    }

    const airQualityService = accessory.addService(Service.AirQualitySensor);
    bindCharacteristic(device, ScryptedInterface.AirQualitySensor, airQualityService, Characteristic.AirQuality,
        () => airQualityToHomekit(device.airQuality));

    if (device.interfaces.includes(ScryptedInterface.PM10Sensor)) {
        bindCharacteristic(device, ScryptedInterface.PM10Sensor, airQualityService, Characteristic.PM10Density,
            () => device.pm10Density || 0);
    }
    if (device.interfaces.includes(ScryptedInterface.PM25Sensor)) {
        bindCharacteristic(device, ScryptedInterface.PM25Sensor, airQualityService, Characteristic.PM2_5Density,
            () => device.pm25Density || 0);
    }
    if (device.interfaces.includes(ScryptedInterface.VOCSensor)) {
        bindCharacteristic(device, ScryptedInterface.VOCSensor, airQualityService, Characteristic.VOCDensity,
            () => device.vocDensity || 0);
    }
    if (device.interfaces.includes(ScryptedInterface.NOXSensor)) {
        bindCharacteristic(device, ScryptedInterface.NOXSensor, airQualityService, Characteristic.NitrogenDioxideDensity,
            () => device.noxDensity || 0);
    }

    return airQualityService;
}

export function addCarbonDioxideSensor(device: ScryptedDevice & CO2Sensor, accessory: Accessory): Service {
    if (!device.interfaces.includes(ScryptedInterface.CO2Sensor))
        return undefined;

    const co2Service = accessory.addService(Service.CarbonDioxideSensor, device.name);
    bindCharacteristic(device, ScryptedInterface.CO2Sensor, co2Service, Characteristic.CarbonDioxideLevel,
        () => device.co2ppm || 0);
    bindCharacteristic(device, ScryptedInterface.CO2Sensor, co2Service, Characteristic.CarbonDioxideDetected,
        () => ((device.co2ppm || 0) > 5000));

    return co2Service;
}

export function addFan(device: ScryptedDevice & Fan & OnOff, accessory: Accessory): Service {
    if (!device.interfaces.includes(ScryptedInterface.OnOff) && !device.interfaces.includes(ScryptedInterface.Fan))
        return undefined;

    const service = accessory.addService(Service.Fanv2, device.name);

    if (device.interfaces.includes(ScryptedInterface.OnOff)) {
        bindCharacteristic(device, ScryptedInterface.OnOff, service, Characteristic.Active,
            () => !!device.on);

        service.getCharacteristic(Characteristic.Active).on(CharacteristicEventTypes.SET, (value, callback) => {
            callback();
            if (value)
                device.turnOn();
            else
                device.turnOff();
        });
    }

    if (device.fan?.counterClockwise !== undefined) {
        bindCharacteristic(device, ScryptedInterface.Fan, service, Characteristic.RotationDirection,
            () => device.fan?.counterClockwise ? Characteristic.RotationDirection.COUNTER_CLOCKWISE : Characteristic.RotationDirection.CLOCKWISE);
        service.getCharacteristic(Characteristic.RotationDirection).on(CharacteristicEventTypes.SET, (value, callback) => {
            callback();
            device.setFan({
                counterClockwise: value === Characteristic.RotationDirection.COUNTER_CLOCKWISE,
            });
        });
    }

    if (device.fan?.swing !== undefined) {
        bindCharacteristic(device, ScryptedInterface.Fan, service, Characteristic.SwingMode,
            () => device.fan?.swing ? Characteristic.SwingMode.SWING_ENABLED : Characteristic.SwingMode.SWING_DISABLED);
        service.getCharacteristic(Characteristic.SwingMode).on(CharacteristicEventTypes.SET, (value, callback) => {
            callback();
            device.setFan({
                swing: value === Characteristic.SwingMode.SWING_ENABLED,
            });
        });
    }

    if (device.fan?.maxSpeed !== undefined) {
        bindCharacteristic(device, ScryptedInterface.Fan, service, Characteristic.RotationSpeed,
            () => {
                const speed = device.fan?.speed;
                if (!speed)
                    return 0;
                const maxSpeed = device.fan?.maxSpeed;
                if (!maxSpeed)
                    return 100;
                const fraction = speed / maxSpeed;
                return Math.abs(Math.round(fraction * 100));
            });
        service.getCharacteristic(Characteristic.RotationSpeed).on(CharacteristicEventTypes.SET, (value, callback) => {
            callback();
            const maxSpeed = device.fan?.maxSpeed;
            const speed = maxSpeed
                ? Math.round((value as number) / 100 * maxSpeed)
                : 1;
            device.setFan({
                speed,
            });
        });
        service.getCharacteristic(Characteristic.RotationSpeed).setProps({
            minStep: 100 / device.fan?.maxSpeed,
        });
    }

    if (device.fan?.availableModes !== undefined) {
        bindCharacteristic(device, ScryptedInterface.Fan, service, Characteristic.TargetFanState,
            () => device.fan?.mode === FanMode.Manual
                ? Characteristic.TargetFanState.MANUAL
                : Characteristic.TargetFanState.AUTO);
        service.getCharacteristic(Characteristic.TargetFanState).on(CharacteristicEventTypes.SET, (value, callback) => {
            callback();
            device.setFan({
                mode: value === Characteristic.TargetFanState.MANUAL ? FanMode.Manual : FanMode.Auto,
            });
        });

        bindCharacteristic(device, ScryptedInterface.Fan, service, Characteristic.CurrentFanState,
            () => !device.fan?.active
                ? Characteristic.CurrentFanState.INACTIVE
                : !device.fan.speed
                    ? Characteristic.CurrentFanState.IDLE
                    : Characteristic.CurrentFanState.BLOWING_AIR);
    }

    return service;
}

/*
 * mergeOnOffDevicesByType looks for the specified type of child devices under the
 * given device provider and merges them as switches to the accessory represented
 * by the device provider.
 *
 * Returns the services created as well as all of the child OnOff devices which have
 * been merged.
 */
export function mergeOnOffDevicesByType(device: ScryptedDevice & DeviceProvider, accessory: Accessory, type: ScryptedDeviceType): { services: Service[], devices: (ScryptedDevice & OnOff)[] } {
    if (!device.interfaces.includes(ScryptedInterface.DeviceProvider))
        return undefined;

    const children = getChildDevices(device);
    const mergedDevices = [];
    const services = children.map((child: ScryptedDevice & OnOff) => {
        if (child.type !== type || !child.interfaces.includes(ScryptedInterface.OnOff))
            return undefined;

        const onOffService = getOnOffService(child, accessory, Service.Switch)
        mergedDevices.push(child);
        return onOffService;
    });

    return {
        services: services.filter(service => !!service),
        devices: mergedDevices,
    };
}