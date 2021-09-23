// https://developer.scrypted.app/#getting-started
// package.json contains the metadata (name, interfaces) about this device
// under the "scrypted" key.
import { BinarySensor, OnOff, ScryptedDeviceBase } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
const { log } = sdk;

// OnOff is a simple binary switch. See "interfaces"  in package.json
// to add support for more capabilities, like Brightness or Lock.

class DummyBinarySensor extends ScryptedDeviceBase implements OnOff, BinarySensor {
    constructor() {
        super();
        this.on = this.on || false;
        this.binaryState = this.binaryState || false;
    }
    async turnOff() {
        this.on = false;
        this.binaryState = false;
    }
    async turnOn() {
        this.on = true;
        this.binaryState = true;
    }
}

export default new DummyBinarySensor();
