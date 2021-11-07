import sdk, {Brightness, OnOff} from "@scrypted/sdk";
import { ValueID, CommandClasses } from "@zwave-js/core";
import { ZwaveDeviceBase } from "./ZwaveDeviceBase";

export class BrightnessToSwitchMultilevel extends ZwaveDeviceBase implements OnOff, Brightness {
    async turnOff() {
        await this.setBrightnessInternal(0);
    }

    async turnOn() {
        await this.setBrightnessInternal(255);
    }

    async setBrightness(brightness: number) {
        await this.setBrightnessInternal(Math.min(Math.max(brightness, 0), 99));
    }

    async setBrightnessInternal(brightness: number): Promise<void> {
        this._polling = Date.now();
        if (await this.instance.commandClasses['Multilevel Switch'].set(brightness))
            this.brightness = Math.min(100, brightness);
        this._refresh()
    }

    _polling: number;

    _refresh() {
        setTimeout(() => {
            this.instance.getNodeUnsafe().refreshCCValues(CommandClasses["Multilevel Switch"])
            .catch(_ => {});
        }, 5000);
    }

    static updateState(zwaveDevice: BrightnessToSwitchMultilevel, valueId: ValueID) {
        let brightness: number = zwaveDevice.getValue(valueId);

        // dimmer devices may have a fade in/out. so poll the value until it settles (or 30 sec mac)
        // to watch for the on/off events. otherwise devices may get stuck in some mid-dim value.
        if (zwaveDevice._polling) {
            if (Date.now() > zwaveDevice._polling + 30000) {
                zwaveDevice._polling = undefined;
            }
            else {
                zwaveDevice._refresh();
            }
        }

        if (brightness === 99) {
            brightness = 100;
        }
        zwaveDevice.brightness = brightness;
        zwaveDevice.on = !!brightness;
    }
}

export default BrightnessToSwitchMultilevel;
