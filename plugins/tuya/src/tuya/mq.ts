import { TuyaCloud } from "./cloud";
import { v1 as uuidV1 } from 'uuid'
import * as mqtt from "mqtt"
import { MQTTConfig } from "./const";
import sdk from '@scrypted/sdk';

const { log } = sdk;

export class TuyaMQ {
    private mqttClient: mqtt.MqttClient | undefined;
    private readonly linkId: string = `tuya-plugin-scrypted.${uuidV1()}`;

    constructor(
        private readonly cloud: TuyaCloud
    ) {

    }

    public async start() {
        if (this.mqttClient) {
            this.mqttClient.end();
        }

        this.mqttClient = undefined;

        let mqttConfigResult = await this.cloud.post<MQTTConfig>('/v1.0/iot-03/open-hub/access-config', {
            uid: this.cloud.getSessionUserId(),
            link_id: this.linkId,
            link_type: 'mqtt',
            topics: 'devices',
            msg_encrypted_version: '2.0'
        });

        if (mqttConfigResult.success) {
            const mqttConfig = mqttConfigResult.result;
            this.startMQTT(mqttConfig);
        }
    }

    private async startMQTT(config: MQTTConfig) {
        const mqttClient = mqtt.connect(config.url, {
            clientId: config.client_id,
            username: config.username,
            password: config.password
        });

        mqttClient.on('connect', async () => {
            log.i(`Successfully connected to Tuya MQTT.`);
        });

        mqttClient.on('error', async () => {
            log.w(`There was an error connecting to Tuya MQTT.`);
        });
        mqttClient.on('close', async () => {
            log.w(`Closing Tuya MQTT connection.`);
        });
        // this.mqttClient.on('message', async (strz));
        mqttClient.subscribe(config.source_topic);
        this.mqttClient = mqttClient;
    }
}