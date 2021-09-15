// https://developer.scrypted.app/#getting-started
// package.json contains the metadata (name, interfaces) about this device
// under the "scrypted" key.
import { MotionSensor, OnOff, ScryptedDeviceBase } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
const { log } = sdk;

// OnOff is a simple binary switch. See "interfaces"  in package.json
// to add support for more capabilities, like Brightness or Lock.

class DummyMotionSensor extends ScryptedDeviceBase implements OnOff, MotionSensor {
    constructor() {
        super();
        this.on = this.on || false;
        this.motionDetected = this.motionDetected || false;
    }
    async turnOff() {
        this.on = false;
        this.motionDetected = false;
    }
    async turnOn() {
        this.on = true;
        this.motionDetected = true;
    }
}

export default new DummyMotionSensor();
