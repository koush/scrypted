import type { ScryptedDeviceBase } from "@scrypted/sdk";
import type { MqttClient, MqttSubscriptions } from "./mqtt-client";

declare const mqtt: MqttClient;
declare const device: ScryptedDeviceBase;


export type FrigateObjectType =
    'person' |
    'bicycle' |
    'car' |
    'motorcycle' |
    'airplane' |
    'bus' |
    'train' |
    'car' |
    'boat' |
    'traffic light' |
    'fire hydrant' |
    'stop sign' |
    'parking meter' |
    'bench' |
    'bird' |
    'cat' |
    'dog' |
    'horse' |
    'sheep' |
    'cow' |
    'elephant' |
    'bear' |
    'zebra' |
    'giraffe' |
    'backpack' |
    'umbrella' |
    'handbag' |
    'tie' |
    'suitcase' |
    'frisbee' |
    'skis' |
    'snowboard' |
    'sports ball' |
    'kite' |
    'baseball bat' |
    'baseball glove' |
    'skateboard' |
    'surfboard' |
    'tennis racket' |
    'bottle' |
    'wine glass' |
    'cup' |
    'fork' |
    'knife' |
    'spoon' |
    'bowl' |
    'banana' |
    'apple' |
    'sandwich' |
    'orange' |
    'broccoli' |
    'carrot' |
    'hot dog' |
    'pizza' |
    'donut' |
    'cake' |
    'chair' |
    'couch' |
    'potted plant' |
    'bed' |
    'dining table' |
    'toilet' |
    'tv' |
    'laptop' |
    'mouse' |
    'remote' |
    'keyboard' |
    'cell phone' |
    'microwave' |
    'oven' |
    'toaster' |
    'sink' |
    'refrigerator' |
    'book' |
    'clock' |
    'vase' |
    'scissors' |
    'teddy bear' |
    'hair drier' |
    'toothbrush';

export interface FrigateZoneWatcher {
    zone: string,
    objects: FrigateObjectType[];
}

export function frigateMotionSensor(zoneWatcher: FrigateZoneWatcher, ...zoneWatchers: FrigateZoneWatcher[]) {
    const subs: MqttSubscriptions = {};
    const counts: { [type: string]: number } = {};
    for (const z of [zoneWatcher, ...zoneWatchers]) {
        for (const o of z.objects) {
            subs[`/${z.zone}/${o}`] = message => {
                counts[z.zone] = message.json;
                device.motionDetected = Object.values(counts).reduce((a, b) => a + b, 0) !== 0;
            }
        } 
    }
    mqtt.subscribe(subs);
    mqtt.handle({}, "MotionSensor");
}
