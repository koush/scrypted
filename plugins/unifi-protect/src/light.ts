import { Brightness, MotionSensor, OnOff, ScryptedDeviceBase, TemperatureUnit } from "@scrypted/sdk";
import { UnifiProtect } from "./main";
import { UnifiMotionDevice, debounceMotionDetected } from "./camera-sensors";
import { ProtectLightConfig } from "./unifi-protect";

export class UnifiLight extends ScryptedDeviceBase implements OnOff, Brightness, MotionSensor, UnifiMotionDevice {
    motionTimeout: NodeJS.Timeout;

    constructor(public protect: UnifiProtect, nativeId: string, protectLight: Readonly<ProtectLightConfig>) {
        super(nativeId);
        this.temperatureUnit = TemperatureUnit.C;

        this.updateState(protectLight);
        this.console.log(protectLight);
    }
    async turnOff(): Promise<void> {
        const result = await this.protect.api.updateLight(this.findLight(), { lightOnSettings: { isLedForceOn: false } });
        if (!result)
            this.console.error('turnOff failed.');
    }
    async turnOn(): Promise<void> {
        const result = await this.protect.api.updateLight(this.findLight(), { lightOnSettings: { isLedForceOn: true } });
        if (!result)
            this.console.error('turnOn failed.');
    }
    async setBrightness(brightness: number): Promise<void> {
        const ledLevel = Math.round(((brightness as number) / 20) + 1);
        this.protect.api.updateLight(this.findLight(), { lightDeviceSettings: { ledLevel } });
    }

    findLight() {
        const id = this.protect.findId(this.nativeId);
        return this.protect.api.lights.find(light => light.id === id);
    }

    updateState(light?: Readonly<ProtectLightConfig>) {
        light = light || this.findLight();
        if (!light)
            return;
        this.on = !!light.isLightOn;
        // The Protect ledLevel settings goes from 1 - 6. HomeKit expects percentages, so we convert it like so.
        this.brightness = (light.lightDeviceSettings.ledLevel - 1) * 20;
        if (!!light.isPirMotionDetected)
            debounceMotionDetected(this);
    }

    setMotionDetected(motionDetected: boolean) {
        this.motionDetected = motionDetected;
    }
}
