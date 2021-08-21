// here's a fake hardware device that we'll expose to HomeKit
import {
  Accessory,
  AccessoryEventTypes,
  Categories,
  Characteristic,
  CharacteristicValue,
  Service,
  uuid,
  VoidCallback
} from '..';

const FAKE_FAN: Record<string, any> = {
  powerOn: false,
  rSpeed: 100,
  setPowerOn: (on: CharacteristicValue) => {
    if (on) {
      //put your code here to turn on the fan
      FAKE_FAN.powerOn = on;
    } else {
      //put your code here to turn off the fan
      FAKE_FAN.powerOn = on;
    }
  },
  setSpeed: (value: CharacteristicValue) => {
    console.log("Setting fan rSpeed to %s", value);
    FAKE_FAN.rSpeed = value;
    //put your code here to set the fan to a specific value
  },
  identify: () => {
    //put your code here to identify the fan
    console.log("Fan Identified!");
  }
};

// This is the Accessory that we'll return to HAP-NodeJS that represents our fake fan.
const fan = exports.accessory = new Accessory('Fan', uuid.generate('hap-nodejs:accessories:Fan'));

// Add properties for publishing (in case we're using Core.js and not BridgedCore.js)
// @ts-ignore
fan.username = "1A:2B:3C:4D:5E:FF";
// @ts-ignore
fan.pincode = "031-45-154";
// @ts-ignore
fan.category = Categories.FAN;

// set some basic properties (these values are arbitrary and setting them is optional)
fan
  .getService(Service.AccessoryInformation)!
  .setCharacteristic(Characteristic.Manufacturer, "Sample Company")

// listen for the "identify" event for this Accessory
fan.on(AccessoryEventTypes.IDENTIFY, (paired: boolean, callback: VoidCallback) => {
  FAKE_FAN.identify();
  callback(); // success
});

// Add the actual Fan Service and listen for change events from iOS.
fan
  .addService(Service.Fan, "Fan") // services exposed to the user should have "names" like "Fake Light" for us
  .getCharacteristic(Characteristic.On)!
  .onSet((value) => {
    FAKE_FAN.setPowerOn(value);
  });

// We want to intercept requests for our current power state so we can query the hardware itself instead of
// allowing HAP-NodeJS to return the cached Characteristic.value.
fan
  .getService(Service.Fan)!
  .getCharacteristic(Characteristic.On)!
  .onGet(() => {

    // this event is emitted when you ask Siri directly whether your fan is on or not. you might query
    // the fan hardware itself to find this out, then call the callback. But if you take longer than a
    // few seconds to respond, Siri will give up.

    if (FAKE_FAN.powerOn) {
      return true;
    } else {
      return false;
    }
  });

// also add an "optional" Characteristic for speed
fan
  .getService(Service.Fan)!
  .addCharacteristic(Characteristic.RotationSpeed)
  .onGet(async () => {
    return FAKE_FAN.rSpeed;
  })
  .onSet(async (value) => {
    FAKE_FAN.setSpeed(value);
  })
