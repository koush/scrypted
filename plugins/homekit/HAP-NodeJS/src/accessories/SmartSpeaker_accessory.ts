import {
  Accessory,
  Categories,
  Characteristic,
  CharacteristicEventTypes,
  CharacteristicGetCallback,
  CharacteristicSetCallback,
  CharacteristicValue,
  Service,
  uuid
} from "..";

const speakerUUID = uuid.generate('hap-nodejs:accessories:smart-speaker');
const speaker = exports.accessory = new Accessory('SmartSpeaker', speakerUUID);

// @ts-ignore
speaker.username = "89:A8:E4:1E:95:EE";
// @ts-ignore
speaker.pincode = "676-54-344";
speaker.category = Categories.SPEAKER;

const service = new Service.SmartSpeaker('Smart Speaker', '');

let currentMediaState: number = Characteristic.CurrentMediaState.PAUSE;
let targetMediaState: number = Characteristic.TargetMediaState.PAUSE;

// ConfigureName is used to listen for Name changes inside the Home App.
// A device manufacturer would probably need to adjust the name of the device in the AirPlay 2 protocol (or something)
service.setCharacteristic(Characteristic.ConfiguredName, "Smart Speaker");
service.setCharacteristic(Characteristic.Mute, false);
service.setCharacteristic(Characteristic.Volume, 100);

service.getCharacteristic(Characteristic.CurrentMediaState)!
  .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
    console.log("Reading CurrentMediaState: " + currentMediaState);
    callback(undefined, currentMediaState);
  })
  .updateValue(currentMediaState); // init value

service.getCharacteristic(Characteristic.TargetMediaState)!
  .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
    console.log("Setting TargetMediaState to: " + value);
    targetMediaState = value as number;
    currentMediaState = targetMediaState;

    callback();

    service.setCharacteristic(Characteristic.CurrentMediaState, targetMediaState);
  })
  .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
    console.log("Reading TargetMediaState: " + targetMediaState);
    callback(undefined, targetMediaState);
  })
  .updateValue(targetMediaState);

service.getCharacteristic(Characteristic.ConfiguredName)!
  .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
    console.log(`Name was changed to: '${value}'`);
    callback();
  });

speaker.addService(service);


