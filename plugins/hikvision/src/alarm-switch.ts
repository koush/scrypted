import { OnOff, ScryptedDeviceBase } from "@scrypted/sdk";
import type { HikvisionCamera } from "./main";

export class HikvisionAlarmSwitch extends ScryptedDeviceBase implements OnOff {
    on: boolean = false;

    constructor(public camera: HikvisionCamera, nativeId: string) {
        super(nativeId);
        this.on = false;
    }

    async turnOn() {
        this.on = true;
        await this.camera.getClient().setAlarm(true);
    }

    async turnOff() {
        this.on = false;
        await this.camera.getClient().setAlarm(false);
    }
}
