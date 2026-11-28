import { AudioSensor, BinarySensor, CarbonMonoxideSensor, HumiditySensor, MotionSensor, ScryptedDeviceBase, ScryptedInterface, SmokeSensor, TemperatureUnit, Thermometer } from "@scrypted/sdk";
import { UnifiProtect } from "./main";
import { UnifiMotionDevice, debounceMotionDetected } from "./camera-sensors";
import { ProtectSensorConfig } from "./unifi-protect";

// the smoke detector fields are not in the unifi-protect typings yet.
interface ProtectSmokeDetectorConfig {
    featureFlags?: {
        alarmTypes?: string[];
    };
    smokeStatus?: {
        smokeAlarm?: boolean;
        coAlarm?: boolean;
    } | null;
}

export function isSmokeDetector(sensor: Readonly<ProtectSensorConfig>) {
    // other sensors (UP Sense) also advertise smoke and CO alarm types for alarm sound
    // detection and report an idle smokeStatus, so the model is the only reliable signal.
    return sensor.marketName === 'USL Smoke' || !!sensor.type?.startsWith('USL-Smoke-');
}

export function getSmokeDetectorInterfaces(sensor: Readonly<ProtectSensorConfig>) {
    const alarmTypes = (sensor as ProtectSmokeDetectorConfig).featureFlags?.alarmTypes || [];
    const interfaces: ScryptedInterface[] = [];
    if (alarmTypes.includes('smoke'))
        interfaces.push(ScryptedInterface.SmokeSensor);
    if (alarmTypes.includes('CO'))
        interfaces.push(ScryptedInterface.CarbonMonoxideSensor);
    return interfaces;
}

export class UnifiSensor extends ScryptedDeviceBase implements Thermometer, HumiditySensor, AudioSensor, BinarySensor, MotionSensor, SmokeSensor, CarbonMonoxideSensor, UnifiMotionDevice {
    motionTimeout: NodeJS.Timeout;

    constructor(public protect: UnifiProtect, nativeId: string, protectSensor: Readonly<ProtectSensorConfig>) {
        super(nativeId);
        this.temperatureUnit = TemperatureUnit.C;
        this.updateState(protectSensor);
        this.console.log(protectSensor);
    }

    findSensor() {
        const id = this.protect.findId(this.nativeId);
        return this.protect.api.bootstrap.sensors.find(sensor => sensor.id === id);
    }

    async setTemperatureUnit(temperatureUnit: TemperatureUnit): Promise<void> {
        // no op. not supported since it is headless.
    }

    updateState(sensor?: Readonly<ProtectSensorConfig>) {
        sensor = sensor || this.findSensor();
        if (!sensor)
            return;
        if (isSmokeDetector(sensor)) {
            this.updateSmokeDetectorState(sensor);
            return;
        }
        this.temperature = sensor.stats.temperature.value;
        this.humidity = sensor.stats.humidity.value;
        // todo light sensor
        this.binaryState = sensor.isOpened;
        this.audioDetected = !!sensor.alarmTriggeredAt;
        // sensors with an external leak probe report it separately from the internal probe.
        // externalLeakDetectedAt is not in the unifi-protect typings yet.
        const externalLeakDetectedAt = (sensor as any).externalLeakDetectedAt;
        this.flooded = !!sensor.leakDetectedAt || !!externalLeakDetectedAt;
        if (!!sensor.isMotionDetected)
            debounceMotionDetected(this);
    }

    updateSmokeDetectorState(sensor: Readonly<ProtectSensorConfig>) {
        // smokeStatus is null until the detector reports in. keep the last known
        // state in that case rather than clearing an alarm that may still be active.
        const smokeStatus = (sensor as ProtectSmokeDetectorConfig).smokeStatus;
        if (!smokeStatus)
            return;
        const interfaces = getSmokeDetectorInterfaces(sensor);
        if (interfaces.includes(ScryptedInterface.SmokeSensor))
            this.smokeDetected = !!smokeStatus.smokeAlarm;
        if (interfaces.includes(ScryptedInterface.CarbonMonoxideSensor))
            this.carbonMonoxideDetected = !!smokeStatus.coAlarm;
    }

    setMotionDetected(motionDetected: boolean) {
        this.motionDetected = motionDetected;
    }
}
