import {OnOff} from "@scrypted/sdk";
import type { ValueID } from "@zwave-js/core";
import { ZwaveDeviceBase } from "./ZwaveDeviceBase";

export class OnOffToSwitch extends ZwaveDeviceBase implements OnOff {
    async turnOff(): Promise<void> {
        await this.instance.commandClasses['Binary Switch'].set(false);
        this.on = false;
    }

    async turnOn(): Promise<void> {
        await this.instance.commandClasses['Binary Switch'].set(true);
        this.on = true;
    }

    static updateState(zwaveDevice: ZwaveDeviceBase, valueId: ValueID) {
        zwaveDevice.on = zwaveDevice.getValue(valueId);
    }
}

export default OnOffToSwitch;
