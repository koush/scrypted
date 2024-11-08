import { AudioSensor, BinarySensor, HumiditySensor, MotionSensor, ScryptedDeviceBase, TemperatureUnit, Thermometer } from "@scrypted/sdk";
import { UnifiProtect } from "./main";
import { UnifiMotionDevice, debounceMotionDetected } from "./camera-sensors";
import { ProtectSensorConfig } from "./unifi-protect";

export class UnifiSensor extends ScryptedDeviceBase implements Thermometer, HumiditySensor, AudioSensor, BinarySensor, MotionSensor, UnifiMotionDevice {
    motionTimeout: NodeJS.Timeout;

    constructor(public protect: UnifiProtect, nativeId: string, protectSensor: Readonly<ProtectSensorConfig>) {
        super(nativeId);
        this.temperatureUnit = TemperatureUnit.C;
        this.updateState(protectSensor);
        this.console.log(protectSensor);
    }

    findSensor() {
        const id = this.protect.findId(this.nativeId);
        return this.protect.api.sensors.find(sensor => sensor.id === id);
    }

    async setTemperatureUnit(temperatureUnit: TemperatureUnit): Promise<void> {
        // no op. not supported since it is headless.
    }

    updateState(sensor?: Readonly<ProtectSensorConfig>) {
        sensor = sensor || this.findSensor();
        if (!sensor)
            return;
        this.temperature = sensor.stats.temperature.value;
        this.humidity = sensor.stats.humidity.value;
        // todo light sensor
        this.binaryState = sensor.isOpened;
        this.audioDetected = !!sensor.alarmTriggeredAt;
        this.flooded = !!sensor.leakDetectedAt;
        if (!!sensor.isMotionDetected)
            debounceMotionDetected(this);
    }

    setMotionDetected(motionDetected: boolean) {
        this.motionDetected = motionDetected;
    }
}
