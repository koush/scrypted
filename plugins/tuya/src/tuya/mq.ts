import Event from 'events';
import * as mqtt from "mqtt";
import { MQTTConfig } from "./const";
import sdk from '@scrypted/sdk';


export class TuyaMQ {
    static connect = "TUYA_CONNECT";
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

    public start() {
        this.client = this._connect();
    }

    public stop() {
        this.client?.end();
    }

    public connect(
        cb: (client: mqtt.MqttClient) => void
    ) {
        this.event.on(TuyaMQ.connect, cb);
    }

    public message(
        cb: (client: mqtt.MqttClient, message: any) => void
    ) {
        this.event.on(TuyaMQ.message, cb);
    }

    public error(cb: (client: mqtt.MqttClient, error: any) => void) {
        this.event.on(TuyaMQ.error, cb);
    }

    public close(cb: (client: mqtt.MqttClient) => void) {
        this.event.on(TuyaMQ.close, cb);
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
            if (client.connected) {
                this.client?.subscribe(this.config.source_topic);
                this.event.emit(
                    TuyaMQ.connect,
                    this.client
                )   
            }
        });
    }

    private subMessage(client: mqtt.MqttClient) {
        client.on('message', () => {
            client.connected
        });
    }

    private subError(client: mqtt.MqttClient) {
        client.on('error', () => {

        });
    }

    private subClose(client: mqtt.MqttClient) {
        client.on('close', () => {

        });
    }
} 
