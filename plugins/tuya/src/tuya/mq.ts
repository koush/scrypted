import Event from "events";
import { connect, IClientPublishOptions, MqttClient, OnCloseCallback, OnErrorCallback, OnMessageCallback } from "mqtt";
import { IPublishPacket } from "mqtt-packet";
import { EventEmitter } from "events";

export type MqttConfig = {
  url: string;
  clientId: string;
  username: string;
  password: string;
  topics: string[];
  expires: number;
}

export type TuyaMQEvent = {
  connected: [];
  message: Parameters<OnMessageCallback>;
  error: Parameters<OnErrorCallback>
  close: Parameters<OnCloseCallback>
}

export class TuyaMQ extends EventEmitter<TuyaMQEvent> {
  private client?: MqttClient;
  private config: MqttConfig | undefined;
  private fetchConfig: () => Promise<MqttConfig>;
  private retryTimeout: NodeJS.Timeout | undefined;

  constructor(fetchConfig: () => Promise<MqttConfig>) {
    super();
    this.fetchConfig = fetchConfig;
  }
  
  public async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.on("connected", () => {
        resolve();
      });
      this.on("error", (error) => {
        reject(error);
      });
      this._connect();
    });
  }

  public stop() {
    this.client?.end();
    this.client?.removeAllListeners();
    this.client = undefined;
    this.config = undefined;
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = undefined;
    }
  }

  public publish(topic: string, message: string) {
    const properties: IClientPublishOptions = {
      qos: 1,
      retain: false,
    };

    this.client?.publish(topic, message, properties);
  }

  private async _connect() {
    this.stop();
    const config = this.config && (this.config.expires - 60_000) > Date.now() ? this.config : await this.fetchConfig()
    const client = connect(config.url, {
      clientId: config.clientId,
      username: config.username,
      password: config.password,
    });
    client.on("connect", (packet) => {
      if (packet.returnCode === 0) {
        for (const topic of config.topics) {
          client.subscribe(topic);
        }
        this.emit("connected");
      } else if (packet.returnCode === 5) {
        this.emit("error", new Error("Not authorized"));
      } else {
        this.emit("error", new Error("Connection failed to connect."));
      }
    });
    client.on("message", (...args) => {
        this.emit("message", ...args);
    });
    client.on("error", (error: Error) => {
      this.emit("error", error);
      this._connect();
    });
    client.on("close", () => {
      this.emit("close");
      this.stop();
    });
    this.client = client;
    this.config = config;
    this.retryTimeout = setTimeout(this._connect, (config.expires - 60_000) - Date.now())
    return client;
  }
}
