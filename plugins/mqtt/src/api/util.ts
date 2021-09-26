import type { ScryptedDeviceBase, ScryptedInterface } from "@scrypted/sdk";
import type { MqttClient, MqttEvent, MqttSubscriptions } from "./mqtt-client";

declare const device: ScryptedDeviceBase;
declare const mqtt: MqttClient;

export function createMotionSensor(options: {
    topic: string,
    when: (message: MqttEvent) => boolean;
    delay?: number;
}) {
    const subscriptions: MqttSubscriptions = {};
    let timeout: NodeJS.Timeout;
    subscriptions[options.topic] = message => {
        const detected = options.when(message);

        if (!options.delay) {
            device.motionDetected = detected;
            return;
        }

        if (!detected)
            return;

        device.motionDetected = true;
        clearTimeout(timeout);
        timeout = setTimeout(() => device.motionDetected = false, options.delay * 1000);
    };

    mqtt.subscribe(subscriptions);

    mqtt.handleTypes("MotionSensor");
}
