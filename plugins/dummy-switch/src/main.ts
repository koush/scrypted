import { BinarySensor, DeviceProvider, MotionSensor, OnOff, Scriptable, ScriptSource, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting, Settings, SettingValue } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import { createMonacoEvalDefaults, scryptedEval } from '../../../common/src/scrypted-eval';
import child_process from 'child_process';

const { log, deviceManager } = sdk;

class DummySwitch extends ScryptedDeviceBase implements OnOff, Scriptable, MotionSensor, BinarySensor, Settings {
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
    async turnOff(): Promise<void> {
        clearTimeout(this.timeout);
        this.on = false;
        this.motionDetected = false;
        this.binaryState = false;
        const source = JSON.parse(this.storage.getItem('source'));
        this.eval(source);
    }
    async turnOn(): Promise<void> {
        clearTimeout(this.timeout);
        this.on = true;
        this.motionDetected = true;
        this.binaryState = true;
        const source = JSON.parse(this.storage.getItem('source'));
        this.eval(source);

        let reset = parseInt(this.storage.getItem('reset'));
        if (!reset && reset !== 0)
            reset = 10;
        if (reset) {
            this.timeout = setTimeout(() => this.turnOff(), reset * 1000);
        }
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

class DummySwitchProvider extends ScryptedDeviceBase implements DeviceProvider, Settings {
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
                title: 'Add Switch (Shell Script)',
                placeholder: 'Switch Name',
            },
            {
                key: 'typescript:',
                title: 'Add Switch (Typescript)',
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
                ScryptedInterface.Scriptable,
                ScryptedInterface.MotionSensor,
                ScryptedInterface.BinarySensor,
                ScryptedInterface.Settings,
            ],
            type: ScryptedDeviceType.Switch,
        });


        var text = `New Switch ${name} ready. Check the notification area to complete setup.`;
        log.a(text);
        log.clearAlert(text);
    }

    async discoverDevices(duration: number) {
    }

    getDevice(nativeId: string) {
        let ret = this.devices.get(nativeId);
        if (!ret) {
            ret = new DummySwitch(nativeId);
            if (ret)
                this.devices.set(nativeId, ret);
        }
        return ret;
    }
}

export default new DummySwitchProvider();
