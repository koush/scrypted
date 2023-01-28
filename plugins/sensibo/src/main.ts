import { StorageSettings } from '@scrypted/sdk/storage-settings';
import sdk, { Device, DeviceInformation, DeviceProvider, HumiditySensor, Refresh, Fan, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting, Settings, TemperatureSetting, TemperatureUnit, Thermometer, ThermostatMode, FanMode, FanState, FanStatus, TemperatureSettingStatus, TemperatureCommand } from '@scrypted/sdk';
import { SensiboAPI, SensiboPod, SmartMode } from './api';

const { deviceManager } = sdk;

function celsiusToFarenheit(degrees: number): number {
    return (degrees * 1.8) + 32;
}

function fahrenheitToCelsius(degrees: number): number {
    return (degrees - 32) / 1.8;
}

const sensiboModeToThermostatMode = new Map([
    ['cool', ThermostatMode.Cool],
    ['heat', ThermostatMode.Heat],
    ['fan', ThermostatMode.FanOnly],
    ['dry', ThermostatMode.Dry],
    ['auto', ThermostatMode.Auto]
]);

// Generate an inverse map for sensiboModeToThermostatMode
const thermostatModeToSensiboMode = new Map<ThermostatMode, string>(
    Array.from(sensiboModeToThermostatMode).map((entry) => [entry[1], entry[0]])
);

class SensiboThermostat extends ScryptedDeviceBase implements TemperatureSetting, Thermometer, HumiditySensor, Fan, Refresh, Settings {
    pod: SensiboPod;
    storageSettings = new StorageSettings(this, {
        useSmartMode: {
            title: 'Map HeatCool to Climate React',
            key: 'useSmartMode',
            type: 'boolean',
            defaultValue: false,
            description: 'If enabled, HeatCool mode will be provided using the Climate React function of the Sensibo Pod. This will override the existing Climate React configuration.'
        }
    });
    supportedFanSpeeds: string[];
    useSmartMode: boolean;
    smartModeConfig: SmartMode;
    remoteFlavor: string;

    constructor(pod: SensiboPod) {
        super(pod.podInfo.id);
        this.pod = pod;
        this.remoteFlavor = pod.remoteFlavor;
        this.useSmartMode = this.storageSettings.values.useSmartMode;
        // Set a default configuration for smartMode, reading defaults from the Sensibo cloud
        // (if an existing configuration is presentss).
        this.smartModeConfig = {
            enabled: false,
            type: "temperature",
            lowTemperatureThreshold: this.pod.currentSmartMode?.lowTemperatureThreshold ?? 0,
            lowTemperatureState: {
                on: this.pod.currentSmartMode?.lowTemperatureState?.on ?? false,
                mode: 'heat',
                targetTemperature: this.pod.currentSmartMode?.lowTemperatureThreshold ?? 0,
                temperatureUnit: 'C'
            },
            highTemperatureThreshold: this.pod.currentSmartMode?.highTemperatureThreshold ?? 0,
            highTemperatureState: {
                on: this.pod.currentSmartMode?.highTemperatureState?.on ?? false,
                mode: 'cool',
                targetTemperature: this.pod.currentSmartMode?.highTemperatureThreshold ?? 0,
                temperatureUnit: 'C'
            }
        } as SmartMode;

        // Configure supported AC modes based on remoteCapabilities
        const thermostatAvailableModes = [
            ThermostatMode.Off,
            ...Object.entries(this.pod.podInfo.remoteCapabilities.modes).map(
                ([mode, _]) => sensiboModeToThermostatMode.get(mode)
            ),
            // Enable HeatCool mode if control of smartMode is allowed
            ...(this.useSmartMode ? [ThermostatMode.HeatCool] : [])
        ];

        this.temperatureSetting = {
            availableModes: thermostatAvailableModes
        } as TemperatureSettingStatus;

        // Configure supported fan modes/speeds based on remoteCapabilities
        // We assume that fan levels are the same for all modes, which may not be true in all cases
        const fanLevels = Object.entries(this.pod.podInfo.remoteCapabilities.modes)[0][1].fanLevels;
        this.supportedFanSpeeds = fanLevels.filter((level) => level != 'auto');
        var availableModes = [];
        if (this.supportedFanSpeeds.length > 0) {
            availableModes.push(FanMode.Manual);
        }
        if (fanLevels.includes) {
            availableModes.push(FanMode.Auto);
        }

        const swingOptions = Object.entries(this.pod.podInfo.remoteCapabilities.modes)[0][1].swing;

        this.fan = {
            speed: 0,
            ...(availableModes.length > 0 ? {
                mode: availableModes[0],
                availableModes: availableModes,
                active: false
            } : {}),
            maxSpeed: this.supportedFanSpeeds.length - 1,
            ...(swingOptions?.length > 0 ? {
                swing: false
            } : {})
        } as FanStatus;

        this.updateFromCurrentAcState();
    }

    async getSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }

    async putSetting(key: string, value: string | number | boolean) {
        await this.storageSettings.putSetting(key, value);

        if (key === this.storageSettings.keys.useSmartMode) {
            this.log.a(`HeatCool mode ${value === true ? 'enabled' : 'disabled'}, the Sensibo plugin will restart momentarily.`);
            deviceManager.requestRestart();
        }
    }

    updateFromCurrentAcState() {
        // Thermostat interface
        var nextTemperatureSetting = this.temperatureSetting;
        if (this.useSmartMode && this.pod.currentSmartMode?.enabled) {
            nextTemperatureSetting.mode = ThermostatMode.HeatCool;
            nextTemperatureSetting.activeMode = sensiboModeToThermostatMode.get(this.pod.currentAcState.mode);
        } else if (this.pod.currentAcState.on) {
            nextTemperatureSetting.mode = sensiboModeToThermostatMode.get(this.pod.currentAcState.mode);
            if (nextTemperatureSetting.mode === ThermostatMode.Auto) {
                // Guess the active mode based on the ambient and target temperatures
                if (this.pod.measurements.temperature < this.thermostatSetpoint) {
                    nextTemperatureSetting.activeMode = ThermostatMode.Heat;
                } else {
                    nextTemperatureSetting.activeMode = ThermostatMode.Cool;
                }
            } else {
                nextTemperatureSetting.activeMode = this.thermostatMode;
            }
        } else {
            nextTemperatureSetting.mode = ThermostatMode.Off;
            nextTemperatureSetting.activeMode = this.thermostatMode;
        }

        if (this.pod.currentAcState.temperatureUnit === 'F') {
            nextTemperatureSetting.setpoint = fahrenheitToCelsius(this.pod.currentAcState.targetTemperature);
        } else {
            nextTemperatureSetting.setpoint = this.pod.currentAcState.targetTemperature;
        }

        if (this.useSmartMode) {
            nextTemperatureSetting.setpoint = [
                this.smartModeConfig.lowTemperatureThreshold,
                this.smartModeConfig.highTemperatureThreshold
            ];
        }

        this.temperatureSetting = nextTemperatureSetting;
        // Decode temperatureSetting to legacy interface
        // TODO: Remove when not needed
        if (Array.isArray(nextTemperatureSetting.setpoint)) {
            this.thermostatSetpointLow = nextTemperatureSetting.setpoint[0];
            this.thermostatSetpointHigh = nextTemperatureSetting.setpoint[1];
        } else {
            this.thermostatSetpoint = nextTemperatureSetting.setpoint;
        }
        this.thermostatMode = nextTemperatureSetting.mode;
        this.thermostatActiveMode = nextTemperatureSetting.activeMode;

        // Thermometer interface
        this.temperature = this.pod.measurements.temperature;
        if (this.pod.currentAcState.temperatureUnit === 'F') {
            this.temperatureUnit = TemperatureUnit.F;
        } else {
            this.temperatureUnit = TemperatureUnit.C;
        }

        // HumiditySensor interface
        this.humidity = this.pod.measurements.humidity;

        // Fan interface
        var nextFan = this.fan;
        if (this.pod.currentAcState.fanLevel == 'auto') {
            nextFan.mode = FanMode.Auto;
        } else {
            nextFan.mode = FanMode.Manual;
            nextFan.speed = this.supportedFanSpeeds.indexOf(this.pod.currentAcState.fanLevel);
        }
        if (this.pod.currentAcState.swing !== undefined) {
            nextFan.swing = this.pod.currentAcState.swing != 'stopped';
        }
        nextFan.active = this.pod.currentAcState.on;
        this.fan = nextFan;
    }

    async _sync() : Promise<void> {
        if (this.useSmartMode) {
            this.pod.nextSmartMode = this.smartModeConfig;
        }
        await this.pod.sync();
        if (this.pod.remoteFlavor != this.remoteFlavor) {
            // Remote type has changed on the Sensibo, reload the plugin
            this.log.a('The remote emulated by the pod has changed, the Sensibo plugin will restart momentarily.');
            deviceManager.requestRestart();
        }
        this.updateFromCurrentAcState();
    }

    podUsesFahrenheit() : boolean {
        if (typeof this.pod.nextAcState.temperatureUnit !== undefined) {
            return this.pod.nextAcState.temperatureUnit === 'F';
        } else {
            return this.pod.currentAcState.temperatureUnit === 'F';
        }
    }

    async setTemperature(command: TemperatureCommand): Promise<void> {
        if (command.mode === ThermostatMode.Off) {
            this.pod.nextAcState.on = false;
            this.smartModeConfig.enabled = false;
        } else if (command.mode === ThermostatMode.HeatCool) {
            // HeatCool mode is implemented using the SmartMode/'Climate React'
            // system in the Sensibo Pod, which switches the AC from heat to cool
            // based on the temperature sensor in the pod.
            this.pod.nextAcState.on = false;
            this.smartModeConfig.enabled = true;
        } else if (command.mode !== undefined) {
            this.pod.nextAcState.on = true;
            this.smartModeConfig.enabled = false;
            this.pod.nextAcState.mode = thermostatModeToSensiboMode.get(command.mode);
        }

        if (Array.isArray(command.setpoint)) {
            const [low, high] = command.setpoint;
            // Note that the temperature thresholds for smart mode are always in degrees Celsius,
            // so we don't need to adjust them based on the display units. Temperature targets are
            // in degrees Celsius because we set high/lowTemperatureState.temperatureUnit to degrees
            // Celsius in the constructor.
            if (high !== undefined) {
                this.smartModeConfig.highTemperatureThreshold = high;
                this.smartModeConfig.highTemperatureState.on = true;
                this.smartModeConfig.highTemperatureState.targetTemperature = high;
            }
            if (low !== undefined) {
                this.smartModeConfig.lowTemperatureThreshold = low;
                this.smartModeConfig.lowTemperatureState.on = true;
                this.smartModeConfig.lowTemperatureState.targetTemperature = low;
            }
        } else if (command.setpoint !== undefined) {
            // The Sensibo API expects temperature to be set in whatever units are
            // specified by acState.temperatureUnit, but Scrypted uses celsius internally -
            // so we'll need to translate between celsius and fahrenheit whenever the units
            // differ.
            this.pod.nextAcState.targetTemperature =
                this.podUsesFahrenheit() ? celsiusToFarenheit(command.setpoint) : command.setpoint;
        }

        await this._sync();
    }

    async setThermostatMode(mode: ThermostatMode): Promise<void> {
        return this.setTemperature({mode: mode} as TemperatureCommand);
    }

    async setThermostatSetpoint(degrees: number): Promise<void> {
        return this.setTemperature({setpoint: degrees} as TemperatureCommand);
    }

    async setThermostatSetpointHigh(high: number): Promise<void> {
        this.setTemperature({setpoint: [undefined, high]} as TemperatureCommand)
    }

    async setThermostatSetpointLow(low: number): Promise<void> {
        this.setTemperature({setpoint: [low, undefined]} as TemperatureCommand)
    }

    async setTemperatureUnit(temperatureUnit: TemperatureUnit): Promise<void> {
        const wasFahrenheit = this.podUsesFahrenheit();
        this.pod.nextAcState.temperatureUnit = temperatureUnit === TemperatureUnit.F ? 'F' : 'C';
        const isFahrenheit = this.podUsesFahrenheit();

        // Convert pending temperature changes to match the new temperature unit
        if (wasFahrenheit && !isFahrenheit) {
            if (typeof this.pod.nextAcState.targetTemperature !== undefined) {
                this.pod.nextAcState.targetTemperature =
                    fahrenheitToCelsius(this.pod.nextAcState.targetTemperature);
            }
        } else if (!wasFahrenheit && isFahrenheit) {
            if (typeof this.pod.nextAcState.targetTemperature !== undefined) {
                this.pod.nextAcState.targetTemperature =
                celsiusToFarenheit(this.pod.nextAcState.targetTemperature);
            }
        }

        await this._sync();
    }

    async setFan(fan: FanState): Promise<void> {
        if (fan.speed !== undefined || fan.mode === FanMode.Manual) {
            this.pod.nextAcState.fanLevel = this.supportedFanSpeeds[
                fan.speed ?? this.fan.speed
            ];
        };
        if (fan.mode === FanMode.Auto) {
            this.pod.nextAcState.fanLevel = 'auto';
        }

        if (fan.swing !== undefined) {
            if (fan.swing) {
                this.pod.nextAcState.swing = 'rangeFull';
            } else {
                this.pod.nextAcState.swing = 'stopped';
            }
        }

        await this._sync();
    }

    async getRefreshFrequency(): Promise<number> {
        // Apparently Sensibo requested the homebridge plugin set their refresh frequency
        // to 90 seconds, so we do the same here.
        return 90;
    }

    async refresh(refreshInterface: string, userInitiated: boolean): Promise<void> {
        await this._sync();
    }

}

class SensiboProvider extends ScryptedDeviceBase implements DeviceProvider, Settings {
    storageSettings = new StorageSettings(this, {
        apiKey: {
            title: 'API Key',
            key: 'apiKey',
            description: 'Sensibo Cloud API Key, obtained from https://home.sensibo.com/me/api.'
        }
    });
    devices = new Map<string, any>();
    api: SensiboAPI;

    constructor(nativeId?: string) {
        super(nativeId);

        const apiKey = this.storageSettings.values.apiKey;
        if (apiKey) {
            this.log.clearAlerts();
            this.api = new SensiboAPI(apiKey);
            this.discoverDevices();
        } else {
            this.log.a('Enter your API key to connect your Sensibo devices (https://home.sensibo.com/me/api).');
        }
    }

    async getSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }

    async putSetting(key: string, value: string | number | boolean) {
        await this.storageSettings.putSetting(key, value);

        if (key === this.storageSettings.keys.apiKey) {
            this.log.a('API key changed, the Sensibo plugin will restart momentarily.');
            deviceManager.requestRestart();
        }
    }

    async discoverDevices() {
        const pods = await this.api.discoverPods();

        const devices = pods.map(pod => ({
                nativeId: pod.podInfo.id,
                name: `${pod.podInfo.room.name} AC`,
                type: ScryptedDeviceType.Thermostat,
                interfaces: [
                    ScryptedInterface.TemperatureSetting,
                    ScryptedInterface.Thermometer,
                    ScryptedInterface.HumiditySensor,
                    ScryptedInterface.Fan,
                    ScryptedInterface.Refresh,
                    ScryptedInterface.Settings
                ],
                info: {
                    model: pod.podInfo.productModel,
                    manufacturer: 'Sensibo',
                    version: pod.podInfo.firmwareType,
                    firmware: pod.podInfo.firmwareVersion,
                    serialNumber: pod.podInfo.serial,
                    mac: pod.podInfo.macAddress
                } as DeviceInformation,
                room: pod.podInfo.room.name
            } as Device));

        await deviceManager.onDevicesChanged({
            devices: devices
        });

        for (const pod of pods) {
            this.devices.set(pod.podInfo.id, new SensiboThermostat(pod));
        }
    }

    async getDevice(nativeId: string) {
        return this.devices.get(nativeId);
    }

    async releaseDevice(id: string, nativeId: string): Promise<void> {
    }
}

export default SensiboProvider;