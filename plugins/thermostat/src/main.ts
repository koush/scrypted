import sdk, { HumidityCommand, HumidityMode, HumiditySensor, HumiditySetting, OnOff, ScryptedDeviceBase, TemperatureSetting, TemperatureUnit, Thermometer, ThermostatMode } from '@scrypted/sdk';
const { deviceManager, log, systemManager } = sdk;

const sensor = systemManager.getDeviceById<Thermometer & HumiditySensor>(localStorage.getItem('sensor'));
const heater = systemManager.getDeviceById<OnOff>(localStorage.getItem('heater'));
const cooler = systemManager.getDeviceById<OnOff>(localStorage.getItem('cooler'));

class ThermostatDevice extends ScryptedDeviceBase implements TemperatureSetting, Thermometer, HumiditySensor, HumiditySetting {
  constructor() {
    super();

    this.temperature = sensor.temperature;
    // copy the current state from the sensor.
    var unit;
    if (unit = localStorage.getItem('temperatureUnit')) {
      this.temperatureUnit = unit === 'F' ? TemperatureUnit.F : TemperatureUnit.C;
    }
    else {
      log.a('Please specify temperatureUnit C or F in Script Settings.');
      this.temperatureUnit = sensor.temperatureUnit;
    }
    this.humidity = sensor.humidity;
    this.humiditySetting = {
      mode: HumidityMode.Off,
      setpoint: 50,
      activeMode: HumidityMode.Off,
      availableModes: [HumidityMode.Auto, HumidityMode.Humidify, HumidityMode.Dehumidify],
    };

    var modes: ThermostatMode[] = [];
    modes.push(ThermostatMode.Off);
    if (cooler) {
      modes.push(ThermostatMode.Cool);
    }
    if (heater) {
      modes.push(ThermostatMode.Heat);
    }
    if (heater && cooler) {
      modes.push(ThermostatMode.HeatCool);
    }
    modes.push(ThermostatMode.On);
    this.thermostatAvailableModes = modes;

    try {
      if (!this.thermostatMode) {
        this.thermostatMode = ThermostatMode.Off;
      }
    }
    catch (e) {
    }
  }

  async setHumidity(humidity: HumidityCommand): Promise<void> {
    this.humiditySetting = {
      mode: humidity.mode,
      setpoint: 50,
      activeMode: HumidityMode.Off,
      availableModes: [HumidityMode.Auto, HumidityMode.Humidify, HumidityMode.Dehumidify],
    }
  }

  // whenever the temperature changes, or a new command is sent, this updates the current state accordingly.
  updateState() {
    var threshold = 2;

    var thermostatMode = this.thermostatMode || ThermostatMode.Off;

    if (!thermostatMode) {
      log.e('thermostat mode not set');
      return;
    }

    // this holds the last known state of the thermostat.
    // ie, what it decided to do, the last time it updated its state.
    var thermostatState = localStorage.getItem('thermostatState');

    // set the state before turning any devices on or off.
    // on/off events will need to be resolved by looking at the state to
    // determine if it is manual user input.
    function setState(state) {
      if (state == thermostatState) {
        // log.i('Thermostat state unchanged. ' + state)
        return;
      }

      log.i('Thermostat state changed. ' + state);
      localStorage.setItem('thermostatState', state);
    }

    function manageSetpoint(temperatureDifference, er, other, ing, ed) {
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

    function allOff() {
      if (heater && heater.on) {
        heater.turnOff();
      }
      if (cooler && cooler.on) {
        cooler.turnOff();
      }
    }

    if (thermostatMode == 'Off') {
      setState('Off');
      allOff();
      return;

    } else if (thermostatMode == 'Cool') {

      let thermostatSetpoint = this.thermostatSetpoint || sensor.temperature;
      if (!thermostatSetpoint) {
        log.e('No thermostat setpoint is defined.');
        return;
      }

      var temperatureDifference = sensor.temperature - thermostatSetpoint;
      manageSetpoint(temperatureDifference, cooler, heater, 'Cooling', 'Cooled');
      return;

    } else if (thermostatMode == 'Heat') {

      let thermostatSetpoint = this.thermostatSetpoint || sensor.temperature;
      if (!thermostatSetpoint) {
        log.e('No thermostat setpoint is defined.');
        return;
      }

      var temperatureDifference = thermostatSetpoint - sensor.temperature;
      manageSetpoint(temperatureDifference, heater, cooler, 'Heating', 'Heated');
      return;

    } else if (thermostatMode == 'HeatCool') {

      var temperature = sensor.temperature;
      var thermostatSetpointLow = this.thermostatSetpointLow || sensor.temperature;
      var thermostatSetpointHigh = this.thermostatSetpointHigh || sensor.temperature;

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
        var temperatureDifference = thermostatSetpointHigh - temperature;
        manageSetpoint(temperatureDifference, heater, null, 'Heating', 'Heated');
        return;
      } else if (temperature > thermostatSetpointHigh || thermostatState == 'Cooling') {
        var temperatureDifference = temperature - thermostatSetpointLow;
        manageSetpoint(temperatureDifference, cooler, null, 'Cooling', 'Cooled');
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
  async setThermostatSetpoint(thermostatSetpoint) {
    log.i('thermostatSetpoint changed ' + thermostatSetpoint);
    this.thermostatSetpoint = thermostatSetpoint;
    this.updateState();
  }
  async setThermostatSetpointLow(thermostatSetpointLow) {
    log.i('thermostatSetpointLow changed ' + thermostatSetpointLow);
    this.thermostatSetpointLow = thermostatSetpointLow;
    this.updateState();
  }
  async setThermostatSetpointHigh(thermostatSetpointHigh) {
    log.i('thermostatSetpointHigh changed ' + thermostatSetpointHigh);
    this.thermostatSetpointHigh = thermostatSetpointHigh;
    this.updateState();
  }
  async setThermostatMode(mode) {
    log.i('thermostat mode set to ' + mode);
    if (mode == 'On') {
      mode = localStorage.getItem("lastThermostatMode");
    }
    else if (mode != 'Off') {
      localStorage.setItem("lastThermostatMode", mode);
    }
    this.thermostatMode = mode;
    this.updateState();
  }
  // end implementation of TemperatureSetting
  // If the heater or cooler gets turned on or off manually (or programatically),
  // make this resolve with the current state. This relies on the state being set
  // before any devices are turned on or off (as mentioned above) to avoid race
  // conditions.
  manageEvent(on, ing) {
    var state = localStorage.getItem('thermostatState');
    if (on) {
      // on implies it must be heating/cooling
      if (state != ing) {
        // should this be Heat/Cool?
        this.setThermostatMode('On');
        return;
      }
      return;
    }

    // off implies that it must NOT be heating/cooling
    if (state == ing) {
      this.setThermostatMode('Off');
      return;
    }
  }
}








var thermostatDevice = new ThermostatDevice();

function alertAndThrow(msg) {
  log.a(msg);
  throw new Error(msg);
}

try {
  if (!sensor)
    throw new Error();
}
catch {
  alertAndThrow('Setup Incomplete: Assign a thermometer and humidity sensor to the "sensor" variable.');
}
log.clearAlerts();

if (!heater && !cooler) {
  alertAndThrow('Setup Incomplete: Assign an OnOff device to the "heater" and/or "cooler" OnOff variables.');
}
log.clearAlerts();

// register to listen for temperature change events
sensor.listen('Thermometer', function(source, event, data) {
  thermostatDevice[event.property] = data;
  if (event.property == 'temperature') {
    log.i('temperature event: ' + data);
    thermostatDevice.updateState();
  }
});

// listen to humidity events too, and pass those along
sensor.listen('HumiditySensor', function(source, event, data) {
  thermostatDevice[event.property] = data;
});

// Watch for on/off events, some of them may be physical
// button presses, and those will need to be resolved by
// checking the state versus the event.
if (heater) {
  heater.listen('OnOff', function(source, event, on) {
    thermostatDevice.manageEvent(on, 'Heating');
  });
}
if (cooler) {
  cooler.listen('OnOff', function(source, event, on) {
    thermostatDevice.manageEvent(on, 'Cooling');
  });
}

export default thermostatDevice;
