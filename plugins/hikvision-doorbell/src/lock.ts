import sdk, { ScryptedDeviceBase, SettingValue, ScryptedInterface, Setting, Settings, Lock, LockState, Readme } from "@scrypted/sdk";
import { HikvisionDoorbellAPI } from "./doorbell-api";
import { HikvisionDoorbellProvider } from "./main";
import * as fs from 'fs/promises';
import { join } from 'path';

const { deviceManager } = sdk;

export class HikvisionLock extends ScryptedDeviceBase implements Lock, Settings, Readme {

    // timeout: NodeJS.Timeout;

    private provider: HikvisionDoorbellProvider;

    constructor(nativeId: string, provider: HikvisionDoorbellProvider) {
        super (nativeId);

        this.lockState = this.lockState || LockState.Unlocked;
        this.provider = provider;
        
        // provider.updateLock (nativeId, this.name);
    }

    async getReadmeMarkdown(): Promise<string> 
    {
        const fileName = join (process.cwd(), 'LOCK_README.md');
        return fs.readFile (fileName, 'utf-8');
    }

    lock(): Promise<void> {
        return this.getClient().closeDoor();
    }
    unlock(): Promise<void> {
        return this.getClient().openDoor();
    }

    async getSettings(): Promise<Setting[]> {
        const cameraNativeId = this.storage.getItem (HikvisionDoorbellProvider.CAMERA_NATIVE_ID_KEY);
        const state = deviceManager.getDeviceState (cameraNativeId);
        return [
            {
                key: 'parentDevice',
                title: 'Linked Doorbell Device Name',
                description: 'The name of the associated doorbell plugin device (for information)',
                value: state.id,
                readonly: true,
                type: 'device',
            },
            {
                key: 'ip',
                title: 'IP Address',
                description: 'IP address of the doorbell device (for information)',
                value: this.storage.getItem ('ip'),
                readonly: true,
                type: 'string',
            }
        ]
    }
    async putSetting(key: string, value: SettingValue): Promise<void> {
        this.storage.setItem(key, value.toString());
    }

    getClient(): HikvisionDoorbellAPI
    {
        const ip = this.storage.getItem ('ip');
        const port = this.storage.getItem ('port');
        const user = this.storage.getItem ('user');
        const pass = this.storage.getItem ('pass');

        return this.provider.createSharedClient(ip, port, user, pass, this.console, this.storage);
    }

    static deviceInterfaces: string[] = [
        ScryptedInterface.Lock,
        ScryptedInterface.Settings,
        ScryptedInterface.Readme
    ];
}
/*
class DummyDeviceProvider extends ScryptedDeviceBase implements DeviceProvider, DeviceCreator {
    devices = new Map<string, DummyDevice>();

    constructor(nativeId?: string) {
        super(nativeId);

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
*/
