import type { ScryptedDeviceBase } from "@scrypted/sdk";
import type { MqttClient, MqttEvent, MqttSubscriptions } from "./mqtt-client";

declare const device: ScryptedDeviceBase;
export declare const mqtt: MqttClient;

export function createSensor(options: {
    type: string,
    topic: string,
    when: (message: MqttEvent) => boolean;
    set: (value: boolean) => void,
    delay?: number;
}) {
    const subscriptions: MqttSubscriptions = {};
    let timeout: NodeJS.Timeout;
    subscriptions[options.topic] = message => {
        const detected = options.when(message);

        if (!options.delay) {
            options.set(detected);
            return;
        }

        if (!detected)
            return;

        options.set(true);
        clearTimeout(timeout);
        timeout = setTimeout(() => options.set(false), options.delay * 1000);
    };

    mqtt.subscribe(subscriptions);

    mqtt.handleTypes(options.type);
}

export function createMotionSensor(options: {
    topic: string,
    when: (message: MqttEvent) => boolean;
    delay?: number;
}) {
    return createSensor({
        type: "MotionSensor",
        topic: options.topic,
        set: (value: boolean) => device.motionDetected = value,
        when: options.when,
        delay: options.delay,
    })
}

export function createBinarySensor(options: {
    topic: string,
    when: (message: MqttEvent) => boolean;
    delay?: number;
}) {
    return createSensor({
        type: "BinarySensor",
        topic: options.topic,
        set: (value: boolean) => device.binaryState = value,
        when: options.when,
        delay: options.delay,
    })
}
