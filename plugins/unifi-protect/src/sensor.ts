import { ScryptedDeviceBase, MotionSensor, BinarySensor, AudioSensor, HumiditySensor, Thermometer, TemperatureUnit } from "@scrypted/sdk";
import { ProtectSensorConfig } from "./unifi-protect";
import { UnifiProtect } from "./main";

export class UnifiSensor extends ScryptedDeviceBase implements Thermometer, HumiditySensor, AudioSensor, BinarySensor, MotionSensor {
    constructor(public protect: UnifiProtect, nativeId: string, protectSensor: Readonly<ProtectSensorConfig>) {
        super(nativeId);
        this.temperatureUnit = TemperatureUnit.C;
        this.updateState(protectSensor);
        this.console.log(protectSensor);
    }

    findSensor() {
        return this.protect.api.sensors.find(sensor => sensor.id === this.nativeId);
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
        this.setMotionDetected(!!sensor.isMotionDetected);
    }

    setMotionDetected(motionDetected: boolean) {
        this.motionDetected = motionDetected;
    }
}
