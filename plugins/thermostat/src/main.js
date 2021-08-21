import sdk from '@scrypted/sdk';
const { deviceManager, log } = sdk;

function ThermostatDevice() {
  this.state = deviceManager.getDeviceState();

  // determine what is available. undefined stuff will throw;
  try {
    this.heater = heater;
  }
  catch (e) {
  }
  try {
    this.cooler = cooler;
  }
  catch (e) {
  }

  var safeCopyProperty = function(property) {
    try {
      this.state[property] = sensor[property];
    }
    catch(e) {
    }
  }.bind(this);

  var maybeCopyTemperature = function(property) {
    try {
      if (!this.state[property]) {
        this.state[property] = sensor.temperature;
      }
    }
    catch(e) {
    }
  }.bind(this);

  // copy the current state from the sensor.
  safeCopyProperty('temperature');
  var unit;
  if (unit = localStorage.getItem('temperatureUnit')) {
    this.state.temperatureUnit = unit === 'F' ? 'F' : 'C';
  }
  else {
    log.a('Please specify temperatureUnit C or F in Script Settings.');
    safeCopyProperty('temperatureUnit');
  }
  safeCopyProperty('humidity');

  maybeCopyTemperature('thermostatSetpoint');
  maybeCopyTemperature('thermostatSetpointLow');
  maybeCopyTemperature('thermostatSetpointHigh');

  var modes = [];
  modes.push('Off')
  if (this.cooler) {
    modes.push('Cool');
  }
  if (this.heater) {
    modes.push('Heat');
  }
  if (this.heater && this.cooler) {
    modes.push('HeatCool');
  }
  modes.push('On');
  this.state.thermostatAvailableModes = modes;

  try {
    if (!this.state.thermostatMode) {
      this.state.thermostatMode = 'Off';
    }
  }
  catch (e) {
  }
}

// whenever the temperature changes, or a new command is sent, this updates the current state accordingly.
ThermostatDevice.prototype.updateState = function() {
  var heater = this.heater;
  var cooler = this.cooler;

  var threshold = 2;

  var thermostatMode = this.state.thermostatMode || 'Off';

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
      log.e('Thermostat mode set to '+ thermostatMode + ', but ' + thermostatMode.lower() + 'er variable is not defined.');
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
    
    var thermostatSetpoint = this.state.thermostatSetpoint || sensor.temperature;
    if (!thermostatSetpoint) {
      log.e('No thermostat setpoint is defined.');
      return;
    }

    var temperatureDifference = sensor.temperature - thermostatSetpoint;
    manageSetpoint(temperatureDifference, cooler, heater, 'Cooling', 'Cooled');
    return;

  } else if (thermostatMode == 'Heat') {

    var thermostatSetpoint = this.state.thermostatSetpoint || sensor.temperature;
    if (!thermostatSetpoint) {
      log.e('No thermostat setpoint is defined.');
      return;
    }

    var temperatureDifference = thermostatSetpoint - sensor.temperature;
    manageSetpoint(temperatureDifference, heater, cooler, 'Heating', 'Heated');
    return;

  } else if (thermostatMode == 'HeatCool') {

    var temperature = sensor.temperature;
    var thermostatSetpointLow = this.state.thermostatSetpointLow || sensor.temperature;
    var thermostatSetpointHigh = this.state.thermostatSetpointHigh || sensor.temperature;

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
      manageSetpoint(temperatureDifference, heater, 'Heating', 'Heated');
      return;
    } else if (temperature > thermostatSetpointHigh || thermostatState == 'Cooling') {
      var temperatureDifference = temperature - thermostatSetpointLow;
      manageSetpoint(temperatureDifference, cooler, 'Cooling', 'Cooled');
      return;
    }

    // temperature is within tolerance, so this is now HeatCooled
    setState('HeatCooled');
    allOff();
    return;
  }

  log.e('Unknown mode ' + thermostatMode)
};

// implementation of TemperatureSetting

ThermostatDevice.prototype.setThermostatSetpoint = function(thermostatSetpoint) {
  log.i('thermostatSetpoint changed ' + thermostatSetpoint);
  this.state.thermostatSetpoint = thermostatSetpoint;
  this.updateState();
};

ThermostatDevice.prototype.setThermostatSetpointLow = function(thermostatSetpointLow) {
  log.i('thermostatSetpointLow changed ' + thermostatSetpointLow);
  this.state.thermostatSetpointLow = thermostatSetpointLow;
  this.updateState();
};

ThermostatDevice.prototype.setThermostatSetpointHigh = function(thermostatSetpointHigh) {
  log.i('thermostatSetpointHigh changed ' + thermostatSetpointHigh);
  this.state.thermostatSetpointHigh = thermostatSetpointHigh;
  this.updateState();
};

ThermostatDevice.prototype.setThermostatMode = function(mode) {
  log.i('thermostat mode set to ' + mode);
  if (mode == 'On') {
    mode = localStorage.getItem("lastThermostatMode");
  }
  else if (mode != 'Off') {
    localStorage.setItem("lastThermostatMode", mode);
  }
  this.state.thermostatMode = mode;
  this.updateState();
};

// end implementation of TemperatureSetting

// If the heater or cooler gets turned on or off manually (or programatically),
// make this resolve with the current state. This relies on the state being set
// before any devices are turned on or off (as mentioned above) to avoid race
// conditions.
ThermostatDevice.prototype.manageEvent = function(on, ing) {
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
};


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

if (!thermostatDevice.heater && !thermostatDevice.cooler) {
  alertAndThrow('Setup Incomplete: Assign an OnOff device to the "heater" and/or "cooler" OnOff variables.');
}
log.clearAlerts();

// register to listen for temperature change events
sensor.listen('Thermometer', function(source, event, data) {
  thermostatDevice.state[event.property] = data;
  if (event.property == 'temperature') {
    log.i('temperature event: ' + data);
    thermostatDevice.updateState();
  }
});

// listen to humidity events too, and pass those along
sensor.listen('HumiditySensor', function(source, event, data) {
  thermostatDevice.state[event.property] = data;
});

// Watch for on/off events, some of them may be physical
// button presses, and those will need to be resolved by
// checking the state versus the event.
if (thermostatDevice.heater) {
  thermostatDevice.heater.listen('OnOff', function(source, event, on) {
    thermostatDevice.manageEvent(on, 'Heating');
  });
}
if (thermostatDevice.cooler) {
  thermostatDevice.cooler.listen('OnOff', function(source, event, on) {
    thermostatDevice.manageEvent(on, 'Cooling');
  });
}

export default thermostatDevice;
