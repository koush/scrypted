//In This example we create an air conditioner Accessory that Has a Thermostat linked to a Fan Service.
//For example, I've also put a Light Service that should be hidden to represent a light in the closet that is part of the AC. It is to show how to hide services.
//The linking and Hiding does NOT appear to be reflected in Home

// here's a fake hardware device that we'll expose to HomeKit
import {
  Accessory,
  AccessoryEventTypes,
  Categories,
  Characteristic,
  CharacteristicEventTypes,
  CharacteristicGetCallback,
  CharacteristicSetCallback,
  CharacteristicValue,
  Service,
  uuid,
} from '..';
import { VoidCallback } from '../types';

const ACTest_data: Record<string, CharacteristicValue> = {
  fanPowerOn: false,
  rSpeed: 100,
  CurrentHeatingCoolingState: 1,
  TargetHeatingCoolingState: 1,
  CurrentTemperature: 33,
  TargetTemperature: 32,
  TemperatureDisplayUnits: 1,
  LightOn: false
};

// This is the Accessory that we'll return to HAP-NodeJS that represents our fake fan.
const ACTest = exports.accessory = new Accessory('Air Conditioner', uuid.generate('hap-nodejs:accessories:airconditioner'));

// Add properties for publishing (in case we're using Core.js and not BridgedCore.js)
// @ts-ignore
ACTest.username = "1A:2B:3C:4D:5E:FF";
// @ts-ignore
ACTest.pincode = "031-45-154";
// @ts-ignore
ACTest.category = Categories.THERMOSTAT;

// set some basic properties (these values are arbitrary and setting them is optional)
ACTest
  .getService(Service.AccessoryInformation)!
  .setCharacteristic(Characteristic.Manufacturer, "Sample Company")

// listen for the "identify" event for this Accessory
ACTest.on(AccessoryEventTypes.IDENTIFY, (paired: boolean, callback: VoidCallback) => {
  console.log("Fan Identified!");
  callback(); // success
});

// Add the actual Fan Service and listen for change events from iOS.

const FanService = ACTest.addService(Service.Fan, "Blower"); // services exposed to the user should have "names" like "Fake Light" for us
FanService.getCharacteristic(Characteristic.On)!
  .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
    console.log("Fan Power Changed To "+value);
    ACTest_data.fanPowerOn=value
    callback(); // Our fake Fan is synchronous - this value has been successfully set
  });

// We want to intercept requests for our current power state so we can query the hardware itself instead of
// allowing HAP-NodeJS to return the cached Characteristic.value.
FanService.getCharacteristic(Characteristic.On)!
  .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {

    // this event is emitted when you ask Siri directly whether your fan is on or not. you might query
    // the fan hardware itself to find this out, then call the callback. But if you take longer than a
    // few seconds to respond, Siri will give up.

    const err = null; // in case there were any problems

    if (ACTest_data.fanPowerOn) {
      callback(err, true);
    }
    else {
      callback(err, false);
    }
  });


// also add an "optional" Characteristic for speed
FanService.addCharacteristic(Characteristic.RotationSpeed)
  .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
    callback(null, ACTest_data.rSpeed);
  })
  .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
    console.log("Setting fan rSpeed to %s", value);
    ACTest_data.rSpeed=value
    callback();
  })

const ThermostatService = ACTest.addService(Service.Thermostat, "Thermostat");
ThermostatService.addLinkedService(FanService);
ThermostatService.setPrimaryService();

ThermostatService.getCharacteristic(Characteristic.CurrentHeatingCoolingState)!

  .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
    callback(null, ACTest_data.CurrentHeatingCoolingState);
  })
  .on(CharacteristicEventTypes.SET,(value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      ACTest_data.CurrentHeatingCoolingState=value;
      console.log( "Characteristic CurrentHeatingCoolingState changed to %s",value);
      callback();
    });

 ThermostatService.getCharacteristic(Characteristic.TargetHeatingCoolingState)!
  .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
    callback(null, ACTest_data.TargetHeatingCoolingState);
  })
  .on(CharacteristicEventTypes.SET,(value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      ACTest_data.TargetHeatingCoolingState=value;
      console.log( "Characteristic TargetHeatingCoolingState changed to %s",value);
      callback();
    });

 ThermostatService.getCharacteristic(Characteristic.CurrentTemperature)!
  .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
    callback(null, ACTest_data.CurrentTemperature);
  })
  .on(CharacteristicEventTypes.SET,(value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      ACTest_data.CurrentTemperature=value;
      console.log( "Characteristic CurrentTemperature changed to %s",value);
      callback();
    });

 ThermostatService.getCharacteristic(Characteristic.TargetTemperature)!
  .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
    callback(null, ACTest_data.TargetTemperature);
  })
  .on(CharacteristicEventTypes.SET,(value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      ACTest_data.TargetTemperature=value;
      console.log( "Characteristic TargetTemperature changed to %s",value);
      callback();
    });

 ThermostatService.getCharacteristic(Characteristic.TemperatureDisplayUnits)!
  .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
    callback(null, ACTest_data.TemperatureDisplayUnits);
  })
  .on(CharacteristicEventTypes.SET,(value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      ACTest_data.TemperatureDisplayUnits=value;
      console.log( "Characteristic TemperatureDisplayUnits changed to %s",value);
      callback();
    });


const LightService = ACTest.addService(Service.Lightbulb, 'AC Light');
LightService.getCharacteristic(Characteristic.On)!
    .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
      callback(null, ACTest_data.LightOn);
    })
    .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      ACTest_data.LightOn=value;
      console.log( "Characteristic Light On changed to %s",value);
      callback();
    });
LightService.setHiddenService();
