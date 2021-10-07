import { MotionSensor, OnOff, ScryptedDeviceBase } from '@scrypted/sdk';

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
        // automatically stop motion after 10 seconds.
        setTimeout(() => this.turnOff(), 10000);
    }
}

export default new DummyMotionSensor();
