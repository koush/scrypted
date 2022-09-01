import Event from 'events';
import * as mqtt from "mqtt";
import { IClientPublishOptions } from 'mqtt';
import { IPublishPacket } from 'mqtt-packet'
import { MQTTConfig } from "./const";


export class TuyaMQ {
    static connected = "TUYA_CONNECTED";
    static message = "TUYA_MESSAGE";
    static error = "TUYA_ERROR";
    static close = "TUYA_CLOSE";

    private client?: mqtt.MqttClient;
    private config: MQTTConfig;
    private event: Event;

    constructor(
        config: MQTTConfig
    ) {
        this.config = Object.assign({}, config);
        this.event = new Event();
    }

    public stop() {
        this.client?.end();
    }

    public async connect(): Promise<mqtt.Client> {
        return new Promise((resolve, reject) => {
            this.event.on(
                TuyaMQ.connected, 
                (client: mqtt.MqttClient) => {
                    if (client.connected) {
                        resolve(client);
                    } else {
                        reject(new Error('Client did not connect successfully.'));
                    }
                }
            );
            this.client = this._connect();
        });
    }

    public message(
        cb: (client: mqtt.MqttClient, message: any) => void
    ) {
        this.event.on(TuyaMQ.message, cb);
    }

    public error(
        cb: (client: mqtt.MqttClient, error: Error) => void
    ) {
        this.event.on(TuyaMQ.error, cb);
    }

    public close(
        cb: (client: mqtt.MqttClient) => void
    ) {
        this.event.on(TuyaMQ.close, cb);
    }

    public publish(message: string) {
        const properties: IClientPublishOptions = {
            qos: 1,
            retain: false
        }

        this.client?.publish(this.config.sink_topic, message, properties);
    }

    public removeMessageListener(
        cb: (client: mqtt.MqttClient, message: any) => void
    ) {
        this.event.removeListener(TuyaMQ.message, cb);
    }

    private _connect() {
        this.client = mqtt.connect(this.config.url, {
            clientId: this.config.client_id,
            username: this.config.username,
            password: this.config.password
        });

        this.subConnect(this.client);
        this.subMessage(this.client);
        this.subError(this.client);
        this.subClose(this.client);
        return this.client;
    }

    private subConnect(client: mqtt.MqttClient) {
        client.on('connect', () => {
            client.subscribe(this.config.source_topic);
            this.event.emit(
                TuyaMQ.connected,
                client
            )   
        });
    }

    private subMessage(client: mqtt.MqttClient) {
        client.on('message', (topic: string, payload: Buffer, packet: IPublishPacket) => {
            this.event.emit(
                TuyaMQ.message,
                client,
                payload
            )
        });
    }

    private subError(client: mqtt.MqttClient) {
        client.on('error', (error: Error) => {
            this.event.emit(
                TuyaMQ.error,
                error
            )
        });
    }

    private subClose(client: mqtt.MqttClient) {
        client.on('close', () => {
            this.event.emit(
                TuyaMQ.close,
                this.client
            );
        });
    }
} 
