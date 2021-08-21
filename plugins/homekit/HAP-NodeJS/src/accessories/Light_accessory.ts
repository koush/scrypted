import {
  Accessory,
  AccessoryEventTypes,
  Categories,
  Characteristic,
  CharacteristicEventTypes,
  CharacteristicSetCallback,
  CharacteristicValue, ColorUtils,
  NodeCallback,
  Service,
  uuid,
  VoidCallback
} from '..';

class LightControllerClass {

  name: CharacteristicValue = "Simple Light"; //name of accessory
  pincode: CharacteristicValue = "031-45-154";
  username: CharacteristicValue = "FA:3C:ED:5A:1A:1A"; // MAC like address used by HomeKit to differentiate accessories.
  manufacturer: CharacteristicValue = "HAP-NodeJS"; //manufacturer (optional)
  model: CharacteristicValue = "v1.0"; //model (optional)
  serialNumber: CharacteristicValue = "A12S345KGB"; //serial number (optional)

  power: CharacteristicValue = false; //current power status
  brightness: CharacteristicValue = 100; //current brightness
  hue: CharacteristicValue = 0; //current hue
  saturation: CharacteristicValue = 0; //current saturation

  outputLogs = true; //output logs

  setPower(status: CharacteristicValue) { //set power of accessory
    if(this.outputLogs) console.log("Turning the '%s' %s", this.name, status ? "on" : "off");
    this.power = status;
  }

  getPower() { //get power of accessory
    if(this.outputLogs) console.log("'%s' is %s.", this.name, this.power ? "on" : "off");
    return this.power;
  }

  setBrightness(brightness: CharacteristicValue) { //set brightness
    if(this.outputLogs) console.log("Setting '%s' brightness to %s", this.name, brightness);
    this.brightness = brightness;
  }

  getBrightness() { //get brightness
    if(this.outputLogs) console.log("'%s' brightness is %s", this.name, this.brightness);
    return this.brightness;
  }

  setSaturation(saturation: CharacteristicValue) { //set brightness
    if(this.outputLogs) console.log("Setting '%s' saturation to %s", this.name, saturation);
    this.saturation = saturation;
  }

  getSaturation() { //get brightness
    if(this.outputLogs) console.log("'%s' saturation is %s", this.name, this.saturation);
    return this.saturation;
  }

  setHue(hue: CharacteristicValue) { //set brightness
    if(this.outputLogs) console.log("Setting '%s' hue to %s", this.name, hue);
    this.hue = hue;
  }

  getHue() { //get hue
    if(this.outputLogs) console.log("'%s' hue is %s", this.name, this.hue);
    return this.hue;
  }

  identify() { //identify the accessory
    if(this.outputLogs) console.log("Identify the '%s'", this.name);
  }
}

const LightController = new LightControllerClass();

// Generate a consistent UUID for our light Accessory that will remain the same even when
// restarting our server. We use the `uuid.generate` helper function to create a deterministic
// UUID based on an arbitrary "namespace" and the word "light".
const lightUUID = uuid.generate('hap-nodejs:accessories:light' + LightController.name);

// This is the Accessory that we'll return to HAP-NodeJS that represents our light.
const lightAccessory = exports.accessory = new Accessory(LightController.name as string, lightUUID);

// Add properties for publishing (in case we're using Core.js and not BridgedCore.js)
// @ts-ignore
lightAccessory.username = LightController.username;
// @ts-ignore
lightAccessory.pincode = LightController.pincode;
// @ts-ignore
lightAccessory.category = Categories.LIGHTBULB;

// set some basic properties (these values are arbitrary and setting them is optional)
lightAccessory
  .getService(Service.AccessoryInformation)!
    .setCharacteristic(Characteristic.Manufacturer, LightController.manufacturer)
    .setCharacteristic(Characteristic.Model, LightController.model)
    .setCharacteristic(Characteristic.SerialNumber, LightController.serialNumber);

// listen for the "identify" event for this Accessory
lightAccessory.on(AccessoryEventTypes.IDENTIFY, (paired: boolean, callback: VoidCallback) => {
  LightController.identify();
  callback();
});

const lightbulb = lightAccessory.addService(Service.Lightbulb, LightController.name); // services exposed to the user should have "names" like "Light" for this case

lightbulb.getCharacteristic(Characteristic.On)
  .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
    LightController.setPower(value);

    // Our light is synchronous - this value has been successfully set
    // Invoke the callback when you finished processing the request
    // If it's going to take more than 1s to finish the request, try to invoke the callback
    // after getting the request instead of after finishing it. This avoids blocking other
    // requests from HomeKit.
    callback();
  })
  // We want to intercept requests for our current power state so we can query the hardware itself instead of
  // allowing HAP-NodeJS to return the cached Characteristic.value.
  .on(CharacteristicEventTypes.GET, (callback: NodeCallback<CharacteristicValue>) => {
    callback(null, LightController.getPower());
  });

// To inform HomeKit about changes occurred outside of HomeKit (like user physically turn on the light)
// Please use Characteristic.updateValue
//
// lightAccessory
//   .getService(Service.Lightbulb)
//   .getCharacteristic(Characteristic.On)
//   .updateValue(true);

// also add an "optional" Characteristic for Brightness
lightbulb.addCharacteristic(Characteristic.Brightness)
  .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
    LightController.setBrightness(value);
    callback();
  })
  .on(CharacteristicEventTypes.GET, (callback: NodeCallback<CharacteristicValue>) => {
    callback(null, LightController.getBrightness());
  });


// also add an "optional" Characteristic for Saturation
lightbulb.addCharacteristic(Characteristic.Saturation)
  .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
    LightController.setSaturation(value);
    callback();
  })
  .on(CharacteristicEventTypes.GET, (callback: NodeCallback<CharacteristicValue>) => {
    callback(null, LightController.getSaturation());
  });

// also add an "optional" Characteristic for Hue
lightbulb.addCharacteristic(Characteristic.Hue)
  .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
    LightController.setHue(value);
    callback();
  })
  .on(CharacteristicEventTypes.GET, (callback: NodeCallback<CharacteristicValue>) => {
    callback(null, LightController.getHue());
  });
