import { ScryptedInterface } from "@scrypted/sdk";

export interface MqttEvent {
    buffer?: Buffer;
    json?: any;
    text?: string;
}

export interface MqttSubscriptions {
    [topic: string]: (event: MqttEvent) => void;
}

export interface MqttHandler {

}

export interface MqttClient {
    subscribe(subscriptions: MqttSubscriptions, options?: any): void;
    handle<T>(handler?: T, ...interfaces: string[]): void;
    publish(topic: string, value: any): Promise<void>;
}
