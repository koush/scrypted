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
