import path from 'path';

import storage from 'node-persist';

import { Accessory, AccessoryEventTypes, AccessoryLoader, Bridge, Categories, uuid, VoidCallback } from './';

console.log("HAP-NodeJS starting...");

console.warn("DEPRECATION NOTICE: The use of Core and BridgeCore are deprecated and are scheduled to be remove in October 2020. " +
  "For more information and some guidance on how to migrate, have a look at https://github.com/homebridge/HAP-NodeJS/wiki/Deprecation-of-Core-and-BridgeCore");

// Initialize our storage system
storage.initSync();

// Start by creating our Bridge which will host all loaded Accessories
const bridge = new Bridge('Node Bridge', uuid.generate("Node Bridge"));

// Listen for bridge identification event
bridge.on(AccessoryEventTypes.IDENTIFY, (paired: boolean, callback: VoidCallback) => {
  console.log("Node Bridge identify");
  callback(); // success
});

// Load up all accessories in the /accessories folder
const dir = path.join(__dirname, "accessories");
const accessories = AccessoryLoader.loadDirectory(dir);

// Add them all to the bridge
accessories.forEach((accessory: Accessory) => {
  bridge.addBridgedAccessory(accessory);
});

// Publish the Bridge on the local network.
bridge.publish({
  username: "CC:22:3D:E3:CE:F6",
  port: 51826,
  pincode: "031-45-154",
  category: Categories.BRIDGE
});

const signals = {'SIGINT': 2, 'SIGTERM': 15} as Record<string, number>;
Object.keys(signals).forEach((signal: any) => {
  process.on(signal, function () {
    bridge.unpublish();
    setTimeout(function (){
        process.exit(128 + signals[signal]);
    }, 1000)
  });
});
