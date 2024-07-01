import sdk, { ScryptedDeviceBase, SettingValue, ScryptedInterface, Setting, Settings, Readme, OnOff } from "@scrypted/sdk";
import { HikvisionDoorbellProvider } from "./main";
import * as fs from 'fs/promises';
import { join } from 'path';
import { parseBooleans } from "xml2js/lib/processors";

const { deviceManager } = sdk;

export class HikvisionTamperAlert extends ScryptedDeviceBase implements OnOff, Settings, Readme {

    // timeout: NodeJS.Timeout;

    private static ONOFF_KEY: string = "onoff";

    constructor(nativeId: string) {
        super (nativeId);

        this.on = parseBooleans (this.storage.getItem (HikvisionTamperAlert.ONOFF_KEY));
    }

    async getReadmeMarkdown(): Promise<string> 
    {
        const fileName = join (process.cwd(), 'ALERT_README.md');
        return fs.readFile (fileName, 'utf-8');
    }

    turnOff(): Promise<void> 
    {
        this.on = false;
        this.storage.setItem(HikvisionTamperAlert.ONOFF_KEY, 'false');
        return;
    }
    turnOn(): Promise<void> 
    {
        this.on = true;
        this.storage.setItem(HikvisionTamperAlert.ONOFF_KEY, 'true');
        return;
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

    static deviceInterfaces: string[] = [
        ScryptedInterface.OnOff,
        ScryptedInterface.Settings,
        ScryptedInterface.Readme
    ];
}
