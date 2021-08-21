// here's a fake temperature sensor device that we'll expose to HomeKit
import { Accessory, Categories, Characteristic, CharacteristicEventTypes, CharacteristicValue, NodeCallback, Service, uuid } from '..';

const FAKE_SENSOR = {
  currentTemperature: 50,
  getTemperature: function () {
    console.log("Getting the current temperature!");
    return FAKE_SENSOR.currentTemperature;
  },
  randomizeTemperature: function () {
    // randomize temperature to a value between 0 and 100
    FAKE_SENSOR.currentTemperature = Math.round(Math.random() * 100);
  }
};


// Generate a consistent UUID for our Temperature Sensor Accessory that will remain the same
// even when restarting our server. We use the `uuid.generate` helper function to create
// a deterministic UUID based on an arbitrary "namespace" and the string "temperature-sensor".
const sensorUUID = uuid.generate('hap-nodejs:accessories:temperature-sensor');

// This is the Accessory that we'll return to HAP-NodeJS that represents our fake lock.
const sensor = exports.accessory = new Accessory('Temperature Sensor', sensorUUID);

// Add properties for publishing (in case we're using Core.js and not BridgedCore.js)
// @ts-ignore
sensor.username = "C1:5D:3A:AE:5E:FA";
// @ts-ignore
sensor.pincode = "031-45-154";
// @ts-ignore
sensor.category = Categories.SENSOR;

// Add the actual TemperatureSensor Service.
sensor
  .addService(Service.TemperatureSensor)!
  .getCharacteristic(Characteristic.CurrentTemperature)!
  .on(CharacteristicEventTypes.GET, (callback: NodeCallback<CharacteristicValue>) => {

    // return our current value
    callback(null, FAKE_SENSOR.getTemperature());
  });

// randomize our temperature reading every 3 seconds
setInterval(function() {

  FAKE_SENSOR.randomizeTemperature();

  // update the characteristic value so interested iOS devices can get notified
  sensor
    .getService(Service.TemperatureSensor)!
    .setCharacteristic(Characteristic.CurrentTemperature, FAKE_SENSOR.currentTemperature);

}, 3000);
