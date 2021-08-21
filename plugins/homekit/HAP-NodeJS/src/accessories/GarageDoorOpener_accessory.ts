import {
  Accessory,
  AccessoryEventTypes,
  Categories,
  Characteristic,
  CharacteristicEventTypes, CharacteristicSetCallback, CharacteristicValue,
  NodeCallback,
  Service,
  uuid,
  VoidCallback
} from '..';

const FAKE_GARAGE = {
  opened: false,
  open: () => {
    console.log("Opening the Garage!");
    //add your code here which allows the garage to open
    FAKE_GARAGE.opened = true;
  },
  close: () => {
    console.log("Closing the Garage!");
    //add your code here which allows the garage to close
    FAKE_GARAGE.opened = false;
  },
  identify: () => {
    //add your code here which allows the garage to be identified
    console.log("Identify the Garage");
  },
  status: () => {
    //use this section to get sensor values. set the boolean FAKE_GARAGE.opened with a sensor value.
    console.log("Sensor queried!");
    //FAKE_GARAGE.opened = true/false;
  }
};

const garageUUID = uuid.generate('hap-nodejs:accessories:' + 'GarageDoor');
const garage = exports.accessory = new Accessory('Garage Door', garageUUID);

// Add properties for publishing (in case we're using Core.js and not BridgedCore.js)
// @ts-ignore
garage.username = "C1:5D:3F:EE:5E:FA"; //edit this if you use Core.js
// @ts-ignore
garage.pincode = "031-45-154";
// @ts-ignore
garage.category = Categories.GARAGE_DOOR_OPENER;

garage
  .getService(Service.AccessoryInformation)!
  .setCharacteristic(Characteristic.Manufacturer, "Liftmaster")
  .setCharacteristic(Characteristic.Model, "Rev-1")
  .setCharacteristic(Characteristic.SerialNumber, "TW000165");

garage.on(AccessoryEventTypes.IDENTIFY, (paired: boolean, callback: VoidCallback) => {
  FAKE_GARAGE.identify();
  callback();
});

garage
  .addService(Service.GarageDoorOpener, "Garage Door")
  .setCharacteristic(Characteristic.TargetDoorState, Characteristic.TargetDoorState.CLOSED) // force initial state to CLOSED
  .getCharacteristic(Characteristic.TargetDoorState)!
  .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {

    if (value == Characteristic.TargetDoorState.CLOSED) {
      FAKE_GARAGE.close();
      callback();
      garage
        .getService(Service.GarageDoorOpener)!
        .setCharacteristic(Characteristic.CurrentDoorState, Characteristic.CurrentDoorState.CLOSED);
    }
    else if (value == Characteristic.TargetDoorState.OPEN) {
      FAKE_GARAGE.open();
      callback();
      garage
        .getService(Service.GarageDoorOpener)!
        .setCharacteristic(Characteristic.CurrentDoorState, Characteristic.CurrentDoorState.OPEN);
    }
  });


garage
  .getService(Service.GarageDoorOpener)!
  .getCharacteristic(Characteristic.CurrentDoorState)!
  .on(CharacteristicEventTypes.GET, (callback: NodeCallback<CharacteristicValue>) => {

    const err = null;
    FAKE_GARAGE.status();

    if (FAKE_GARAGE.opened) {
      console.log("Query: Is Garage Open? Yes.");
      callback(err, Characteristic.CurrentDoorState.OPEN);
    }
    else {
      console.log("Query: Is Garage Open? No.");
      callback(err, Characteristic.CurrentDoorState.CLOSED);
    }
  });
