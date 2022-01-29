import { BinarySensor, DeviceProvider, Lock, LockState, MotionSensor, OccupancySensor, OnOff, Scriptable, ScriptSource, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting, Settings, SettingValue, StartStop } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import { createMonacoEvalDefaults, scryptedEval } from '../../../common/src/scrypted-eval';
import child_process from 'child_process';

const { log, deviceManager } = sdk;

class DummyDevice extends ScryptedDeviceBase implements OnOff, Lock, StartStop, Scriptable, OccupancySensor, MotionSensor, BinarySensor, Settings {
    language: string;
    timeout: NodeJS.Timeout;

    constructor(nativeId: string) {
        super(nativeId);

        if (nativeId.startsWith('typescript:'))
            this.language = 'typescript';
        else
            this.language = 'shell';

        this.motionDetected = this.motionDetected || false;
        this.binaryState = this.binaryState || false;
        this.on = this.on || false;
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

    evalSource() {
        try {
            const source = JSON.parse(this.storage.getItem('source'));
            return this.eval(source);
        }
        catch (e) {
        }
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

        this.evalSource();
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

        this.evalSource();
    }
    async saveScript(script: ScriptSource): Promise<void> {
        this.storage.setItem('source', JSON.stringify(script));
    }
    async loadScripts(): Promise<{ [filename: string]: ScriptSource; }> {
        const filename = this.language === 'typescript' ? 'dummy-switch-script.ts' : 'dummy-switch-script.sh';
        const ret: { [filename: string]: ScriptSource; } = {
        };

        try {
            const source = JSON.parse(this.storage.getItem('source'));
            ret[filename] = source;
        }
        catch (e) {
            ret[filename] = {
                script: '',
            }
        }
        Object.assign(ret[filename], {
            language: this.language,
            name: 'Switch Script',
            monacoEvalDefaults: this.language === 'typescript' ? createMonacoEvalDefaults({}) : undefined,
        });
        return ret;
    }
    async eval(source: ScriptSource, variables?: { [name: string]: any; }): Promise<any> {
        if (this.language === 'typescript')
            return scryptedEval(this, source.script, {}, {});
        const cp = child_process.spawn('sh', {
            env: {
                DUMMY_ON: (!!this.on).toString(),
            },
        });
        cp.stdin.write(source.script);
        cp.stdin.end();
        cp.stdout.on('data', data => this.console.log(data.toString()));
        cp.stderr.on('data', data => this.console.log(data.toString()));
        cp.on('exit', () => this.console.log('shell exited'));
    }
}

class DummyDeviceProvider extends ScryptedDeviceBase implements DeviceProvider, Settings {
    devices = new Map<string, any>();

    constructor(nativeId?: string) {
        super(nativeId);

        for (const camId of deviceManager.getNativeIds()) {
            if (camId)
                this.getDevice(camId);
        }

    }
    async getSettings(): Promise<Setting[]> {
        return [
            {
                key: 'shell:',
                title: 'Add Dummy Device (Shell Script)',
                placeholder: 'Switch Name',
            },
            {
                key: 'typescript:',
                title: 'Add Dummy Device (Typescript)',
                placeholder: 'Switch Name',
            },
        ]
    }

    async putSetting(key: string, value: string | number) {
        // generate a random id
        const nativeId = key + Math.random().toString();
        const name = value.toString();

        deviceManager.onDeviceDiscovered({
            nativeId,
            name,
            interfaces: [
                ScryptedInterface.OnOff,
                ScryptedInterface.StartStop,
                ScryptedInterface.Lock,
                ScryptedInterface.Scriptable,
                ScryptedInterface.MotionSensor,
                ScryptedInterface.BinarySensor,
                ScryptedInterface.OccupancySensor,
                ScryptedInterface.Settings,
            ],
            type: ScryptedDeviceType.Switch,
        });


        var text = `New Dummy Device ${name} ready. Check the notification area to complete setup.`;
        log.a(text);
        log.clearAlert(text);
    }

    async discoverDevices(duration: number) {
    }

    getDevice(nativeId: string) {
        let ret = this.devices.get(nativeId);
        if (!ret) {
            ret = new DummyDevice(nativeId);
            if (ret)
                this.devices.set(nativeId, ret);
        }
        return ret;
    }
}

export default new DummyDeviceProvider();
