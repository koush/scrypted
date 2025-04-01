import Event from "events";
import { connect, IClientPublishOptions, MqttClient } from "mqtt";
import { IPublishPacket } from "mqtt-packet";

export type MqttConfig = {
  url: string;
  clientId: string;
  username: string;
  password: string;
  topics: string[];
  expires: number;
}

export class TuyaMQ {
  private static connected = "TUYA_CONNECTED";
  private static message = "TUYA_MESSAGE";
  private static error = "TUYA_ERROR";
  private static close = "TUYA_CLOSE";

  private client?: MqttClient;
  private config: MqttConfig;
  private event: Event;

  constructor(config: MqttConfig) {
    this.config = config;
    this.event = new Event();
  }

  public stop() {
    this.client?.end();
  }

  public async connect(): Promise<MqttClient> {
    return new Promise((resolve, reject) => {
      this.event.on(TuyaMQ.connected, (client: MqttClient) => {
        if (client.connected) {
          resolve(client);
        } else {
          reject(new Error("Client did not connect successfully."));
        }
      });
      this.client = this._connect();
    });
  }

  public message(cb: (client: MqttClient, message: any) => void) {
    this.event.on(TuyaMQ.message, cb);
  }

  public error(cb: (client: MqttClient, error: Error) => void) {
    this.event.on(TuyaMQ.error, cb);
  }

  public close(cb: (client: MqttClient) => void) {
    this.event.on(TuyaMQ.close, cb);
  }

  public publish(topic: string, message: string) {
    const properties: IClientPublishOptions = {
      qos: 1,
      retain: false,
    };

    this.client?.publish(topic, message, properties);
  }

  public removeMessageListener(cb: (client: MqttClient, message: any) => void) {
    this.event.removeListener(TuyaMQ.message, cb);
  }

  private _connect() {
    this.client = connect(this.config.url, {
      clientId: this.config.clientId,
      username: this.config.username,
      password: this.config.password,
    });

    this.subConnect(this.client);
    this.subMessage(this.client);
    this.subError(this.client);
    this.subClose(this.client);
    return this.client;
  }

  private subConnect(client: MqttClient) {
    client.on("connect", () => {
      for (const topic of this.config.topics) {
        client.subscribe(topic);
      }
      this.event.emit(TuyaMQ.connected, client);
    });
  }

  private subMessage(client: MqttClient) {
    client.on(
      "message",
      (topic: string, payload: Buffer, packet: IPublishPacket) => {
        this.event.emit(TuyaMQ.message, client, payload);
      }
    );
  }

  private subError(client: MqttClient) {
    client.on("error", (error: Error) => {
      this.event.emit(TuyaMQ.error, error);
    });
  }

  private subClose(client: MqttClient) {
    client.on("close", () => {
      this.event.emit(TuyaMQ.close, this.client);
    });
  }
}
