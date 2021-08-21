import {
  Accessory,
  AdaptiveLightingController,
  AdaptiveLightingControllerMode,
  Categories,
  Characteristic,
  ColorUtils,
  Service,
  uuid
} from "..";

/**
 * This example light gives an example how a light with AdaptiveLighting (in AUTOMATIC mode) support
 * can look like.
 * This example not only exposes the ColorTemperature characteristic but also shows how
 * ColorTemperature and Hue/Saturation characteristics can be combined on a Lightbulb service.
 *
 * The example also uses the new Promise based onGet and onSet handlers instead of the "old"
 * SET/GET event handlers.
 *
 * AdaptiveLighting setup is pretty much at the end of the file, don't miss it.
 */

const lightUUID = uuid.generate('hap-nodejs:accessories:light-adaptive-lighting');
const accessory = exports.accessory = new Accessory("Light Example", lightUUID);

// this section stores the basic state of the lightbulb
let on = false;
let brightness = 100;
let colorTemperature = 140; // 140 is the lowest color temperature in mired as by the HAP spec (you can lower the minimum though)
let hue = 0; // we start with white color
let saturation = 0;

// Add properties for publishing (in case we're using Core.js and not BridgedCore.js)
// @ts-ignore
accessory.username = "AA:BB:CC:DD:EE:FF";
// @ts-ignore
accessory.pincode = "031-45-154";
// @ts-ignore
accessory.category = Categories.LIGHTBULB;

accessory.getService(Service.AccessoryInformation)!
  .setCharacteristic(Characteristic.Manufacturer, "HAP-NodeJS")
  .setCharacteristic(Characteristic.Model, "Light with AdaptiveLighting")
  .setCharacteristic(Characteristic.FirmwareRevision, "1.0.0");

const lightbulbService = accessory.addService(Service.Lightbulb, "Light Example");

lightbulbService.getCharacteristic(Characteristic.On)
  .onGet(() => {
    console.log("Light power is currently " + on);
    return on;
  })
  .onSet(value => {
    console.log("Light power was turn to " + on);
    on = value as boolean;
  });

lightbulbService.getCharacteristic(Characteristic.Brightness) // Brightness characteristic is required for adaptive lighting
  .updateValue(brightness) // ensure default value is set
  .onGet(() => {
    console.log("Light brightness is currently " + brightness);
    return brightness;
  })
  .onSet(value => {
    console.log("Light brightness was set to " + value + "%");
    brightness = value as number;
  });

lightbulbService.getCharacteristic(Characteristic.ColorTemperature) // ColorTemperature characteristic is required for adaptive lighting
  .onGet(() => {
    console.log("Light color temperature is currently " + colorTemperature);
    return colorTemperature;
  })
  .onSet(value => {
    console.log("Light color temperature was set to " + value);
    colorTemperature = value as number;

    // following statements are only needed when using ColorTemperature characteristic in combination with Hue/Saturation
    const color = ColorUtils.colorTemperatureToHueAndSaturation(colorTemperature);
    // save internal values for read handlers
    hue = color.hue;
    saturation = color.saturation;

    // and notify HomeKit devices about changed values
    lightbulbService.getCharacteristic(Characteristic.Hue).updateValue(hue);
    lightbulbService.getCharacteristic(Characteristic.Saturation).updateValue(saturation);
  });

lightbulbService.getCharacteristic(Characteristic.Hue)
  .onGet(() => {
    console.log("Light hue is currently " + hue);
    return hue;
  })
  .onSet(value => {
    console.log("Light hue was set to " + value);
    hue = value as number;
    colorTemperature = 140; // setting color temperature to lowest possible value
  });

lightbulbService.getCharacteristic(Characteristic.Saturation)
  .onGet(() => {
    console.log("Light saturation is currently " + saturation);
    return saturation;
  })
  .onSet(value => {
    console.log("Light saturation was set to " + value);
    saturation = value as number;
    colorTemperature = 140; // setting color temperature to lowest possible value
  });

const adaptiveLightingController = new AdaptiveLightingController(lightbulbService, {
  // options object is optional, default mode is AUTOMATIC, can be set to MANUAL to do transitions yourself
  // look into the docs for more information
  controllerMode: AdaptiveLightingControllerMode.AUTOMATIC,
});
accessory.configureController(adaptiveLightingController);
