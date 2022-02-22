import { ScriptDevice } from '@scrypted/common/src/eval/monaco/script-device';

export interface MqttEvent {
    buffer?: Buffer;
    json?: any;
    text?: string;
}

export interface MqttSubscriptions {
    [topic: string]: (event: MqttEvent) => void;
}

export interface MqttClient extends ScriptDevice {
    subscribe(subscriptions: MqttSubscriptions, options?: any): void;
    publish(topic: string, value: any): Promise<void>;
}
