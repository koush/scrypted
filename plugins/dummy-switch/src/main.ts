import { BinarySensor, DeviceCreator, DeviceCreatorSettings, DeviceProvider, Lock, LockState, MotionSensor, OccupancySensor, OnOff, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting, Settings, SettingValue, StartStop } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import { ReplaceMotionSensor, ReplaceMotionSensorNativeId } from './replace-motion-sensor';
import { ReplaceBinarySensor, ReplaceBinarySensorNativeId } from './replace-binary-sensor';

const { log, deviceManager } = sdk;

class DummyDevice extends ScryptedDeviceBase implements OnOff, Lock, StartStop, OccupancySensor, MotionSensor, BinarySensor, Settings {
    timeout: NodeJS.Timeout;

    constructor(nativeId: string) {
        super(nativeId);

        this.on = this.on || false;
        this.lockState = this.lockState || LockState.Locked;
        this.running = this.running || false;
        this.motionDetected = false;
        this.binaryState = false;
        this.occupied = false;
    }

    lock(): Promise<void> {
        return this.turnOff();
    }
    unlock(): Promise<void> {
        return this.turnOn();
    }
    start(): Promise<void> {
        return this.turnOn();
    }
    stop(): Promise<void> {
        return this.turnOff();
    }
    async getSettings(): Promise<Setting[]> {
        return [
            {
                key: 'reset',
                title: 'Reset Sensor',
                description: 'Reset the motion sensor and binary sensor after the given seconds. Enter 0 to never reset.',
                value: this.storage.getItem('reset') || '10',
                placeholder: '10',
            }
        ]
    }
    async putSetting(key: string, value: SettingValue): Promise<void> {
        this.storage.setItem(key, value.toString());
        clearTimeout(this.timeout);
    }

    // note that turnOff locks the lock
    // this is because, the turnOff should put everything into a "safe"
    // state that does not get attention in the UI.
    // devices that are on, running, or unlocked are generally highlighted.
    async turnOff(): Promise<void> {
        clearTimeout(this.timeout);
        this.on = false;
        this.lockState = LockState.Locked;
        this.running = false;
        this.motionDetected = false;
        this.binaryState = false;
        this.occupied = false;
    }
    async turnOn(): Promise<void> {
        clearTimeout(this.timeout);
        this.on = true;
        this.lockState = LockState.Unlocked;
        this.running = true;
        this.motionDetected = true;
        this.binaryState = true;
        this.occupied = true;

        let reset = parseInt(this.storage.getItem('reset'));
        if (!reset && reset !== 0)
            reset = 10;
        if (reset) {
            this.timeout = setTimeout(() => this.turnOff(), reset * 1000);
        }
    }
}

class DummyDeviceProvider extends ScryptedDeviceBase implements DeviceProvider, DeviceCreator {
    devices = new Map<string, DummyDevice>();

    constructor(nativeId?: string) {
        super(nativeId);

        this.systemDevice = {
            deviceCreator: 'Dummy Switch',
        };

        for (const camId of deviceManager.getNativeIds()) {
            if (camId)
                this.getDevice(camId);
        }

        (async () => {
            await deviceManager.onDeviceDiscovered(
                {
                    name: 'Custom Motion Sensor',
                    nativeId: ReplaceMotionSensorNativeId,
                    interfaces: [ScryptedInterface.MixinProvider],
                    type: ScryptedDeviceType.Builtin,
                },
            );
        })();

        (async () => {
            await deviceManager.onDeviceDiscovered(
                {
                    name: 'Custom Doorbell Button',
                    nativeId: ReplaceBinarySensorNativeId,
                    interfaces: [ScryptedInterface.MixinProvider],
                    type: ScryptedDeviceType.Builtin,
                },
            );
        })();
    }

    async getCreateDeviceSettings(): Promise<Setting[]> {
        return [
            {
                key: 'name',
                title: 'Dummy Switch Name',
                placeholder: 'My Dummy Switch',
            },
        ];
    }

    async createDevice(settings: DeviceCreatorSettings): Promise<string> {
        // generate a random id
        const nativeId = 'shell:' + Math.random().toString();
        const name = settings.name?.toString();

        await this.onDiscovered(nativeId, name);

        return nativeId;
    }

    async onDiscovered(nativeId: string, name: string) {
        await deviceManager.onDeviceDiscovered({
            nativeId,
            name,
            interfaces: [
                ScryptedInterface.OnOff,
                ScryptedInterface.StartStop,
                ScryptedInterface.Lock,
                ScryptedInterface.MotionSensor,
                ScryptedInterface.BinarySensor,
                ScryptedInterface.OccupancySensor,
                ScryptedInterface.Settings,
            ],
            type: ScryptedDeviceType.Switch,
        });
    }

    async getDevice(nativeId: string) {
        if (nativeId === ReplaceMotionSensorNativeId)
            return new ReplaceMotionSensor(ReplaceMotionSensorNativeId);
        if (nativeId === ReplaceBinarySensorNativeId)
            return new ReplaceBinarySensor(ReplaceBinarySensorNativeId);

        let ret = this.devices.get(nativeId);
        if (!ret) {
            ret = new DummyDevice(nativeId);

            // remove legacy scriptable interface
            if (ret.interfaces.includes(ScryptedInterface.Scriptable)) {
                setTimeout(() => this.onDiscovered(ret.nativeId, ret.providedName), 2000);
            }

            if (ret)
                this.devices.set(nativeId, ret);
        }
        return ret;
    }

    async releaseDevice(id: string, nativeId: string): Promise<void> {

    }
}

export default DummyDeviceProvider;
