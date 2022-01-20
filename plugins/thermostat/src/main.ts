import sdk, { EventListenerRegister, HumidityCommand, HumidityMode, HumiditySensor, HumiditySetting, OnOff, ScryptedDevice, ScryptedDeviceBase, ScryptedInterface, ScryptedInterfaceProperty, Setting, Settings, SettingValue, TemperatureSetting, TemperatureUnit, Thermometer, ThermostatMode } from '@scrypted/sdk';
import { StorageSettings } from "../../../common/src/settings"
const { deviceManager, log, systemManager } = sdk;

class ThermostatDevice extends ScryptedDeviceBase implements TemperatureSetting, Thermometer, HumiditySensor, Settings {
  sensor: Thermometer & HumiditySensor & ScryptedDevice;
  heater: OnOff & ScryptedDevice;
  cooler: OnOff & ScryptedDevice;
  listeners: EventListenerRegister[] = [];

  storageSettings = new StorageSettings(this, {
    sensor: {
      title: 'Thermometer',
      description: 'The thermometer used by this virtual thermostat to regulate the temperature.',
      type: 'device',
      deviceFilter: `interfaces.includes("${ScryptedInterface.Thermometer}")`,
      onPut: () => this.updateSettings(),
    },
    heater: {
      title: 'Heating Switch',
      description: 'Optional: The switch that controls your heating unit.',
      type: `device`,
      deviceFilter: `interfaces.includes("${ScryptedInterface.OnOff}")`,
      onPut: () => this.updateSettings(),
    },
    cooler: {
      title: 'Cooling Switch',
      description: 'Optional: The switch that controls your cooling unit.',
      type: `device`,
      deviceFilter: `interfaces.includes("${ScryptedInterface.OnOff}")`,
      onPut: () => this.updateSettings(),
    },
    temperatureUnit: {
      title: 'Temperature Unit',
      choices: ['C', 'F'],
      defaultValue: 'C',
      onPut: () => this.updateSettings(),
    }
  })

  constructor() {
    super();

    this.updateSettings();

    this.temperature = this.sensor?.temperature;
    this.temperatureUnit = this.storageSettings.values.temperatureUnit;
    this.humidity = this.sensor?.humidity;

    const modes: ThermostatMode[] = [];
    modes.push(ThermostatMode.Off);
    if (this.cooler) {
      modes.push(ThermostatMode.Cool);
    }
    if (this.heater) {
      modes.push(ThermostatMode.Heat);
    }
    if (this.heater && this.cooler) {
      modes.push(ThermostatMode.HeatCool);
    }
    modes.push(ThermostatMode.On);
    this.thermostatAvailableModes = modes;

    if (!this.thermostatMode) {
      this.thermostatMode = ThermostatMode.Off;
    }
  }

  manageListener(listener: EventListenerRegister) {
    this.listeners.push(listener);
  }

  clearListeners() {
    for (const listener of this.listeners) {
      listener.removeListener();
    }
    this.listeners = [];
  }

  updateSettings() {
    this.clearListeners();
    this.sensor = this.storageSettings.values.sensor;
    this.heater = this.storageSettings.values.heater;
    this.cooler = this.storageSettings.values.cooler;

    this.log.clearAlerts();
    if (!this.sensor) {
      this.log.a('Setup Incomplete: Select a thermometer.');
      return;
    }

    if (!this.heater && !this.cooler) {
      this.log.a('Setup Incomplete: Assign the switch that controls the heater or air conditioner devices.');
      return;
    }

    if (!this.sensor) {
      this.log.a('Setup Incomplete: Assign a thermometer and humidity sensor to the "sensor" variable.');
      return;
    }

    // register to listen for temperature change events
    this.sensor.listen(ScryptedInterface.Thermometer, (s, d, data) => {
      if (d.property === ScryptedInterfaceProperty.temperature) {
        this.temperature = this.sensor.temperature;
        this.updateState();
      }
    });

    // listen to humidity events too, and pass those along
    this.sensor.listen(ScryptedInterface.Thermometer, (s, d, data) => {
      if (d.property === ScryptedInterfaceProperty.humidity) {
        this.humidity = this.sensor.humidity;
      }
    });

    // Watch for on/off events, some of them may be physical
    // button presses, and those will need to be resolved by
    // checking the state versus the event.
    this.heater?.listen(ScryptedInterface.OnOff, (s, d, data) => {
      this.manageEvent(this.heater.on, 'Heating');
    })

    this.cooler?.listen(ScryptedInterface.OnOff, (s, d, data) => {
      this.manageEvent(this.cooler.on, 'Cooling');
    })
  }

  getSettings(): Promise<Setting[]> {
    return this.storageSettings.getSettings();
  }
  putSetting(key: string, value: SettingValue): Promise<void> {
    return this.storageSettings.putSetting(key, value);
  }

  // whenever the temperature changes, or a new command is sent, this updates the current state accordingly.
  updateState() {
    const threshold = 2;

    const thermostatMode = this.thermostatMode || ThermostatMode.Off;

    if (!thermostatMode) {
      log.e('thermostat mode not set');
      return;
    }

    // this holds the last known state of the thermostat.
    // ie, what it decided to do, the last time it updated its state.
    const thermostatState = this.storage.getItem('thermostatState');

    // set the state before turning any devices on or off.
    // on/off events will need to be resolved by looking at the state to
    // determine if it is manual user input.
    const setState = (state: string) => {
      if (state == thermostatState) {
        // log.i('Thermostat state unchanged. ' + state)
        return;
      }

      log.i('Thermostat state changed. ' + state);
      this.storage.setItem('thermostatState', state);
    }

    const manageSetpoint = (temperatureDifference: number, er: OnOff & ScryptedDevice, other: OnOff & ScryptedDevice, ing: string, ed: string) => {
      if (!er) {
        log.e('Thermostat mode set to ' + thermostatMode + ', but ' + thermostatMode + 'er variable is not defined.');
        return;
      }

      // turn off the other one. if heating, turn off cooler. if cooling, turn off heater.
      if (other && other.on) {
        other.turnOff();
      }

      if (temperatureDifference < 0) {
        setState(ed);
        if (er.on) {
          er.turnOff();
        }
        return;
      }

      // start cooling/heating if way over threshold, or if it is not in the cooling/heating state
      if (temperatureDifference > threshold || thermostatState != ing) {
        setState(ing);
        if (!er.on) {
          er.turnOn();
        }
        return;
      }

      setState(ed);
      if (er.on) {
        er.turnOff();
      }
    }

    const allOff = () => {
      if (this.heater && this.heater.on) {
        this.heater.turnOff();
      }
      if (this.cooler && this.cooler.on) {
        this.cooler.turnOff();
      }
    }

    if (thermostatMode == 'Off') {
      setState('Off');
      allOff();
      return;

    } else if (thermostatMode == 'Cool') {

      let thermostatSetpoint = this.thermostatSetpoint || this.sensor.temperature;
      if (!thermostatSetpoint) {
        log.e('No thermostat setpoint is defined.');
        return;
      }

      const temperatureDifference = this.sensor.temperature - thermostatSetpoint;
      manageSetpoint(temperatureDifference, this.cooler, this.heater, 'Cooling', 'Cooled');
      return;

    } else if (thermostatMode == 'Heat') {

      let thermostatSetpoint = this.thermostatSetpoint || this.sensor.temperature;
      if (!thermostatSetpoint) {
        log.e('No thermostat setpoint is defined.');
        return;
      }

      const temperatureDifference = thermostatSetpoint - this.sensor.temperature;
      manageSetpoint(temperatureDifference, this.heater, this.cooler, 'Heating', 'Heated');
      return;

    } else if (thermostatMode == 'HeatCool') {

      const temperature = this.sensor.temperature;
      const thermostatSetpointLow = this.thermostatSetpointLow || this.sensor.temperature;
      const thermostatSetpointHigh = this.thermostatSetpointHigh || this.sensor.temperature;

      if (!thermostatSetpointLow || !thermostatSetpointHigh) {
        log.e('No thermostat setpoint low/high is defined.');
        return;
      }

      // see if this is within HeatCool tolerance. This prevents immediately cooling after heating all the way to the high setpoint.
      if ((thermostatState == 'HeatCooled' || thermostatState == 'Heated' || thermostatState == 'Cooled')
        && temperature > thermostatSetpointLow - threshold
        && temperature < thermostatSetpointHigh + threshold) {
        // normalize the state into HeatCooled
        setState('HeatCooled');
        allOff();
        return;
      }

      // if already heating or cooling or way out of tolerance, continue doing it until state changes.
      if (temperature < thermostatSetpointLow || thermostatState == 'Heating') {
        const temperatureDifference = thermostatSetpointHigh - temperature;
        manageSetpoint(temperatureDifference, this.heater, null, 'Heating', 'Heated');
        return;
      } else if (temperature > thermostatSetpointHigh || thermostatState == 'Cooling') {
        const temperatureDifference = temperature - thermostatSetpointLow;
        manageSetpoint(temperatureDifference, this.cooler, null, 'Cooling', 'Cooled');
        return;
      }

      // temperature is within tolerance, so this is now HeatCooled
      setState('HeatCooled');
      allOff();
      return;
    }

    log.e('Unknown mode ' + thermostatMode);
  }
  // implementation of TemperatureSetting
  async setThermostatSetpoint(thermostatSetpoint: number) {
    log.i('thermostatSetpoint changed ' + thermostatSetpoint);
    this.thermostatSetpoint = thermostatSetpoint;
    this.updateState();
  }
  async setThermostatSetpointLow(thermostatSetpointLow: number) {
    log.i('thermostatSetpointLow changed ' + thermostatSetpointLow);
    this.thermostatSetpointLow = thermostatSetpointLow;
    this.updateState();
  }
  async setThermostatSetpointHigh(thermostatSetpointHigh: number) {
    log.i('thermostatSetpointHigh changed ' + thermostatSetpointHigh);
    this.thermostatSetpointHigh = thermostatSetpointHigh;
    this.updateState();
  }
  async setThermostatMode(mode: ThermostatMode) {
    log.i('thermostat mode set to ' + mode);
    if (mode === ThermostatMode.On || mode == ThermostatMode.Auto) {
      mode = this.storage.getItem("lastThermostatMode") as ThermostatMode;
    }
    else if (mode != ThermostatMode.Off) {
      this.storage.setItem("lastThermostatMode", mode);
    }
    this.thermostatMode = mode;
    this.updateState();
  }
  // end implementation of TemperatureSetting
  // If the heater or cooler gets turned on or off manually (or programatically),
  // make this resolve with the current state. This relies on the state being set
  // before any devices are turned on or off (as mentioned above) to avoid race
  // conditions.
  manageEvent(on: boolean, ing: string) {
    const state = this.storage.getItem('thermostatState');
    if (on) {
      // on implies it must be heating/cooling
      if (state != ing) {
        // should this be Heat/Cool?
        this.setThermostatMode(ThermostatMode.On);
        return;
      }
      return;
    }

    // off implies that it must NOT be heating/cooling
    if (state == ing) {
      this.setThermostatMode(ThermostatMode.Off);
      return;
    }
  }
}

export default new ThermostatDevice();
