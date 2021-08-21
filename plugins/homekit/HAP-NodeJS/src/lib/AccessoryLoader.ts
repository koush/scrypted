import createDebug from 'debug';
import fs from 'fs';
import path from 'path';
import { CharacteristicValue, Nullable } from '../types';
import { Accessory } from './Accessory';
import {
  Characteristic,
  CharacteristicEventTypes,
  CharacteristicGetCallback,
  CharacteristicSetCallback
} from './Characteristic';
import { Service } from './Service';
import * as uuid from './util/uuid';

const debug = createDebug('HAP-NodeJS:AccessoryLoader');

/**
 * Loads all accessories from the given folder. Handles object-literal-style accessories, "accessory factories",
 * and new-API style modules.
 */

export function loadDirectory(dir: string): Accessory[] {

  // exported accessory objects loaded from this dir
  let accessories: unknown[] = [];

  fs.readdirSync(dir).forEach((file) => {
    const suffix = file.split('_').pop();

    // "Accessories" are modules that export a single accessory.
    if (suffix === 'accessory.js' || suffix === 'accessory.ts') {
      debug('Parsing accessory: %s', file);
      const loadedAccessory = require(path.join(dir, file)).accessory;
      accessories.push(loadedAccessory);
    }
    // "Accessory Factories" are modules that export an array of accessories.
    else if (suffix === 'accfactory.js' ||suffix === 'accfactory.ts') {
      debug('Parsing accessory factory: %s', file);

      // should return an array of objects { accessory: accessory-json }
      const loadedAccessories = require(path.join(dir, file));
      accessories = accessories.concat(loadedAccessories);
    }
  });

  // now we need to coerce all accessory objects into instances of Accessory (some or all of them may
  // be object-literal JSON-style accessories)
  return accessories.map((accessory) => {
    if(accessory === null || accessory === undefined) { //check if accessory is not empty
      console.log("Invalid accessory!");
      return false;
    } else {
      return (accessory instanceof Accessory) ? accessory : parseAccessoryJSON(accessory);
    }
  }).filter((accessory: Accessory | false) => { return !!accessory; }) as Accessory[];
}

/**
 * Accepts object-literal JSON structures from previous versions of HAP-NodeJS and parses them into
 * newer-style structures of Accessory/Service/Characteristic objects.
 */

export function parseAccessoryJSON(json: any) {

  // parse services first so we can extract the accessory name
  const services: Service[] = [];

  json.services.forEach(function(serviceJSON: any) {
    const service = parseServiceJSON(serviceJSON);
    services.push(service);
  });

  let displayName = json.displayName;

  services.forEach(function(service) {
    if (service.UUID === '0000003E-0000-1000-8000-0026BB765291') { // Service.AccessoryInformation.UUID
      service.characteristics.forEach(function(characteristic) {
        if (characteristic.UUID === '00000023-0000-1000-8000-0026BB765291') {// Characteristic.Name.UUID
          displayName = characteristic.value;
        }
      });
    }
  });

  const accessory = new Accessory(displayName, uuid.generate(displayName));

  // create custom properties for "username" and "pincode" for Core.js to find later (if using Core.js)
  // @ts-ignore
  accessory.username = json.username;
  // @ts-ignore
  accessory.pincode = json.pincode;

  // clear out the default services
  accessory.services.length = 0;

  // add services
  services.forEach(function(service) {
    accessory.addService(service);
  });

  return accessory;
}

export function parseServiceJSON(json: any) {
  const serviceUUID = json.sType;

  // build characteristics first so we can extract the Name (if present)
  const characteristics: Characteristic[] = [];

  json.characteristics.forEach((characteristicJSON: any) => {
    const characteristic = parseCharacteristicJSON(characteristicJSON);
    characteristics.push(characteristic);
  });

  let displayName: Nullable<CharacteristicValue> = null;

  // extract the "Name" characteristic to use for 'type' discrimination if necessary
  characteristics.forEach(function(characteristic) {
    if (characteristic.UUID == '00000023-0000-1000-8000-0026BB765291') // Characteristic.Name.UUID
      displayName = characteristic.value;
  });

  // Use UUID for "displayName" if necessary, as the JSON structures don't have a value for this
  const service = new Service(displayName || serviceUUID, serviceUUID, `${displayName}`);

  characteristics.forEach(function(characteristic) {
    if (characteristic.UUID != '00000023-0000-1000-8000-0026BB765291') // Characteristic.Name.UUID, already present in all Services
      service.addCharacteristic(characteristic);
  });

  return service;
}

export function parseCharacteristicJSON(json: any) {
  const characteristicUUID = json.cType;

  const characteristic = new Characteristic(json.manfDescription || characteristicUUID, characteristicUUID, {
    format: json.format, // example: "int"
    minValue: json.designedMinValue,
    maxValue: json.designedMaxValue,
    minStep: json.designedMinStep,
    unit: json.unit,
    perms: json.perms // example: ["pw","pr","ev"]
  });

  // copy simple properties
  characteristic.value = json.initialValue;

  // monkey-patch legacy "locals" property which used to exist.
  // @ts-ignore
  characteristic.locals = json.locals;

  const updateFunc = json.onUpdate; // optional function(value)
  const readFunc = json.onRead; // optional function(callback(value))
  const registerFunc = json.onRegister; // optional function

  if (updateFunc) {
    characteristic.on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
      updateFunc(value);
      callback && callback();
    });
  }

  if (readFunc) {
    characteristic.on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
      readFunc((value: any) => {
        callback(null, value); // old onRead callbacks don't use Error as first param
      });
    });
  }

  if (registerFunc) {
    registerFunc(characteristic);
  }

  return characteristic;
}
