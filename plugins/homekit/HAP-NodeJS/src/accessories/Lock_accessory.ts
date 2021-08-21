import {
  Accessory,
  AccessoryEventTypes,
  Categories,
  Characteristic,
  CharacteristicEventTypes,
  Service,
  uuid
} from '../';

// here's a fake hardware device that we'll expose to HomeKit
const FAKE_LOCK = {
  locked: false,
  lock: () => {
    console.log("Locking the lock!");
    FAKE_LOCK.locked = true;
  },
  unlock: () => {
    console.log("Unlocking the lock!");
    FAKE_LOCK.locked = false;
  },
  identify: () => {
    console.log("Identify the lock!");
  }
};

// Generate a consistent UUID for our Lock Accessory that will remain the same even when
// restarting our server. We use the `uuid.generate` helper function to create a deterministic
// UUID based on an arbitrary "namespace" and the word "lock".
const lockUUID = uuid.generate('hap-nodejs:accessories:lock');

// This is the Accessory that we'll return to HAP-NodeJS that represents our fake lock.
const lock = exports.accessory = new Accessory('Lock', lockUUID);

// Add properties for publishing (in case we're using Core.js and not BridgedCore.js)
// @ts-ignore
lock.username = "C1:5D:3A:EE:5E:FA";
// @ts-ignore
lock.pincode = "031-45-154";
// @ts-ignore
lock.category = Categories.DOOR_LOCK;

// set some basic properties (these values are arbitrary and setting them is optional)
lock
  .getService(Service.AccessoryInformation)!
  .setCharacteristic(Characteristic.Manufacturer, "Lock Manufacturer")
  .setCharacteristic(Characteristic.Model, "Rev-2")
  .setCharacteristic(Characteristic.SerialNumber, "MY-Serial-Number");

// listen for the "identify" event for this Accessory
lock.on(AccessoryEventTypes.IDENTIFY, (paired, callback) => {
  FAKE_LOCK.identify();
  callback(); // success
});

const service = new Service.LockMechanism("Fake Lock");

// Add the actual Door Lock Service and listen for change events from iOS.
service.getCharacteristic(Characteristic.LockTargetState)
  .on(CharacteristicEventTypes.SET, (value, callback) => {

    if (value == Characteristic.LockTargetState.UNSECURED) {
      FAKE_LOCK.unlock();
      callback(); // Our fake Lock is synchronous - this value has been successfully set

      // now we want to set our lock's "actual state" to be unsecured so it shows as unlocked in iOS apps
      service.updateCharacteristic(Characteristic.LockCurrentState, Characteristic.LockCurrentState.UNSECURED);
    } else if (value == Characteristic.LockTargetState.SECURED) {
      FAKE_LOCK.lock();
      callback(); // Our fake Lock is synchronous - this value has been successfully set

      // now we want to set our lock's "actual state" to be locked so it shows as open in iOS apps
      service.updateCharacteristic(Characteristic.LockCurrentState, Characteristic.LockCurrentState.SECURED);
    }
  });

// We want to intercept requests for our current state so we can query the hardware itself instead of
// allowing HAP-NodeJS to return the cached Characteristic.value.
service.getCharacteristic(Characteristic.LockCurrentState)
  .on(CharacteristicEventTypes.GET, callback => {

    // this event is emitted when you ask Siri directly whether your lock is locked or not. you might query
    // the lock hardware itself to find this out, then call the callback. But if you take longer than a
    // few seconds to respond, Siri will give up.

    if (FAKE_LOCK.locked) {
      console.log("Are we locked? Yes.");
      callback(undefined, Characteristic.LockCurrentState.SECURED);
    } else {
      console.log("Are we locked? No.");
      callback(undefined, Characteristic.LockCurrentState.UNSECURED);
    }
  });

lock.addService(service);
