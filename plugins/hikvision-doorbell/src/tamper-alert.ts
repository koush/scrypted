import { OnOff, Readme, ScryptedDeviceBase, ScryptedInterface } from "@scrypted/sdk";
import type { HikvisionCameraDoorbell } from "./main";
import * as fs from 'fs/promises';
import { join } from 'path';
import { parseBooleans } from "xml2js/lib/processors";

export class HikvisionTamperAlert extends ScryptedDeviceBase implements OnOff, Readme {
    on: boolean = false;

    private static ONOFF_KEY: string = "onoff";

    constructor(public camera: HikvisionCameraDoorbell, nativeId: string) {
        super(nativeId);
        this.on = parseBooleans(this.storage.getItem(HikvisionTamperAlert.ONOFF_KEY)) || false;
    }

    async getReadmeMarkdown(): Promise<string> 
    {
        const fileName = join (process.cwd(), 'ALERT_README.md');
        return fs.readFile (fileName, 'utf-8');
    }

    async turnOff(): Promise<void> {
        this.on = false;
        this.storage.setItem(HikvisionTamperAlert.ONOFF_KEY, 'false');
    }
    
    async turnOn(): Promise<void> {
        this.on = true;
        this.storage.setItem(HikvisionTamperAlert.ONOFF_KEY, 'true');
    }


    static deviceInterfaces: string[] = [
        ScryptedInterface.OnOff,
        ScryptedInterface.Readme
    ];
}
