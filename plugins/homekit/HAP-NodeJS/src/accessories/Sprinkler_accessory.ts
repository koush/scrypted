// here's a fake hardware device that we'll expose to HomeKit
import {
  Accessory,
  Categories,
  Characteristic,
  CharacteristicEventTypes,
  CharacteristicSetCallback,
  CharacteristicValue,
  NodeCallback,
  Service,
  uuid
} from '..';

const SPRINKLER: any = {
  active: false,
  name: "Garten Hinten",
  timerEnd: 0,
  defaultDuration: 3600,
  motionDetected: false,

  getStatus: () => {
    //set the boolean here, this will be returned to the device
    SPRINKLER.motionDetected = false;
  },
  identify: () => {
    console.log("Identify the sprinkler!");
  }
};


// Generate a consistent UUID for our Motion Sensor Accessory that will remain the same even when
// restarting our server. We use the `uuid.generate` helper function to create a deterministic
// UUID based on an arbitrary "namespace" and the word "motionsensor".
const sprinklerUUID = uuid.generate('hap-nodejs:accessories:sprinkler');

// This is the Accessory that we'll return to HAP-NodeJS that represents our fake motionSensor.
const sprinkler = exports.accessory = new Accessory('💦 Sprinkler', sprinklerUUID);

// Add properties for publishing (in case we're using Core.js and not BridgedCore.js)
// @ts-ignore
sprinkler.username = "A3:AB:3D:4D:2E:A3";
// @ts-ignore
sprinkler.pincode = "123-44-567";
// @ts-ignore
sprinkler.category = Categories.SPRINKLER;

// Add the actual Valve Service and listen for change events from iOS.
const sprinklerService = sprinkler.addService(Service.Valve, "💦 Sprinkler");


// set some basic properties (these values are arbitrary and setting them is optional)
sprinklerService
  .setCharacteristic(Characteristic.ValveType, "1") // IRRIGATION/SPRINKLER = 1; SHOWER_HEAD = 2; WATER_FAUCET = 3;
  .setCharacteristic(Characteristic.Name, SPRINKLER.name)
  ;

sprinklerService
  .getCharacteristic(Characteristic.Active)!
  .on(CharacteristicEventTypes.GET, (callback: NodeCallback<CharacteristicValue>) => {

    console.log("get Active");
    const err = null; // in case there were any problems

    if (SPRINKLER.active) {
      callback(err, true);
    }
    else {
      callback(err, false);
    }
  })
  .on(CharacteristicEventTypes.SET, (newValue: CharacteristicValue, callback: CharacteristicSetCallback) => {

    console.log("set Active => setNewValue: " + newValue);

    if (SPRINKLER.active) {
      SPRINKLER.active = false;
      closeVentile();
      setTimeout(function() {
        console.log("Ausgeschaltet");
        SPRINKLER.timerEnd = SPRINKLER.defaultDuration + Math.floor(new Date().getTime() / 1000);
        callback(null);

        sprinkler
        .getService(Service.Valve)!
        .setCharacteristic(Characteristic.SetDuration, 0);

        sprinkler
        .getService(Service.Valve)!
        .setCharacteristic(Characteristic.InUse, 0);

      }, 1000);
    }
    else {
      SPRINKLER.active = true;
      openVentile();
      setTimeout(function() {
        console.log("Eingeschaltet");
        SPRINKLER.timerEnd = SPRINKLER.defaultDuration + Math.floor(new Date().getTime() / 1000);
        callback(null, SPRINKLER.defaultDuration);

        sprinkler
        .getService(Service.Valve)!
        .setCharacteristic(Characteristic.InUse, 1);

        sprinkler
        .getService(Service.Valve)!
        .setCharacteristic(Characteristic.RemainingDuration, SPRINKLER.defaultDuration);

        sprinkler
        .getService(Service.Valve)!
        .setCharacteristic(Characteristic.SetDuration, SPRINKLER.defaultDuration);

      }, 1000);
    }
  });


sprinklerService
  .getCharacteristic(Characteristic.InUse)!
  .on(CharacteristicEventTypes.GET, (callback: NodeCallback<CharacteristicValue>) => {
    console.log("get In_Use");
    const err = null; // in case there were any problems

    if (SPRINKLER.active) {
      callback(err, true);
    }
    else {
      callback(err, false);
    }
  })
  .on(CharacteristicEventTypes.SET, (newValue: CharacteristicValue, callback: CharacteristicSetCallback) => {
    console.log("set In_Use => NewValue: " + newValue);
    callback();
  });


sprinklerService
  .getCharacteristic(Characteristic.RemainingDuration)!
  .on(CharacteristicEventTypes.GET, (callback: NodeCallback<CharacteristicValue>) => {

    const err = null; // in case there were any problems

    if (SPRINKLER.active) {

      const duration = SPRINKLER.timerEnd - Math.floor(new Date().getTime() / 1000);
      console.log("RemainingDuration: " + duration)
      callback(err, duration);
    }
    else {
      callback(err, 0);
    }
  });

sprinklerService
  .getCharacteristic(Characteristic.SetDuration)!
  .on(CharacteristicEventTypes.SET, (newValue: CharacteristicValue, callback: CharacteristicSetCallback) => {
    console.log("SetDuration => NewValue: " + newValue);
    SPRINKLER.defaultDuration = newValue;
    callback();
  });


  // Sprinkler Controll
  function openVentile() {
    // Add your code here
  }

  function closeVentile() {
    // Add your code here
  }
