import { BinarySensor, Readme, ScryptedDeviceBase, ScryptedInterface } from "@scrypted/sdk";
import { HikvisionDoorbellAPI } from "./doorbell-api";
import type { HikvisionCameraDoorbell } from "./main";
import * as fs from 'fs/promises';
import { join } from 'path';

export class HikvisionEntrySensor extends ScryptedDeviceBase implements BinarySensor, Readme {

    constructor(public camera: HikvisionCameraDoorbell, nativeId: string, public doorNumber: string = '1') 
    {
        super (nativeId);
        this.binaryState = this.binaryState || false;
    }

    async getReadmeMarkdown(): Promise<string> 
    {
        const fileName = join (process.cwd(), 'ENTRY_SENSOR_README.md');
        return fs.readFile (fileName, 'utf-8');
    }


    private getClient(): HikvisionDoorbellAPI {
        return this.camera.getClient();
    }

    static deviceInterfaces: string[] = [
        ScryptedInterface.BinarySensor,
        ScryptedInterface.Readme
    ];
}
