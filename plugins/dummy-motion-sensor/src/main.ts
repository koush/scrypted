import { MotionSensor, OnOff, ScryptedDeviceBase, Setting, Settings, SettingValue } from '@scrypted/sdk';

class DummyMotionSensor extends ScryptedDeviceBase implements OnOff, MotionSensor, Settings {
    timeout: NodeJS.Timeout;

    constructor() {
        super();
        this.on = this.on || false;
        this.motionDetected = this.motionDetected || false;
    }
    async getSettings(): Promise<Setting[]> {
        return [
            {
                key: 'reset',
                title: 'Reset Motion Sensor',
                description: 'Reset the motion sensor after the given seconds. Enter 0 to never reset.',
                value: this.storage.getItem('reset') || '10',
                placeholder: '10',
            }
        ]
    }

    async putSetting(key: string, value: SettingValue): Promise<void> {
        this.storage.setItem(key, value.toString());
        clearTimeout(this.timeout);
    }
    async turnOff() {
        clearTimeout(this.timeout);
        this.on = false;
        this.motionDetected = false;
    }
    async turnOn() {
        clearTimeout(this.timeout);
        this.on = true;
        this.motionDetected = true;
        // automatically stop motion after 10 seconds.
        let reset = parseInt(this.storage.getItem('reset'));
        if (!reset && reset !== 0)
            reset = 10;
        if (reset) {
            this.timeout = setTimeout(() => this.turnOff(), reset * 1000);
        }
    }
}

export default new DummyMotionSensor();
