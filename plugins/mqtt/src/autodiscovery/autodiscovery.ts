import { Brightness, DeviceProvider, Lock, OnOff, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting, Settings } from "@scrypted/sdk";
import { MqttClient, connect } from "mqtt";
import { MqttDeviceBase } from "../api/mqtt-device-base";
import nunjucks from 'nunjucks';
import sdk from "@scrypted/sdk";

const { deviceManager } = sdk;

interface Component {
    interfaces: string[];
    type: ScryptedDeviceType;
}

const typeMap = new Map<string, Component>();
typeMap.set('switch', {
    interfaces: [ScryptedInterface.OnOff],
    type: ScryptedDeviceType.Switch,
});
typeMap.set('light', {
    interfaces: [ScryptedInterface.OnOff, ScryptedInterface.Brightness],
    type: ScryptedDeviceType.Light,
});
typeMap.set('lock', {
    interfaces: [ScryptedInterface.Lock],
    type: ScryptedDeviceType.Lock,
});
// typeMap.set('binary_sensor', {
//     interfaces: [ScryptedInterface.BinarySensor],
//     type: ScryptedDeviceType.Sensor,
// });

export class MqttAutoDiscoveryProvider extends MqttDeviceBase implements DeviceProvider {
    client: MqttClient;
    pathname: string;
    devices = new Map<string, MqttAutoDiscoveryDevice>();

    constructor(nativeId: string) {
        super(nativeId);

        this.bind();
    }

    bind() {
        try {
            const client = this.connectClient();
            client.subscribe(this.pathname + '#');
            client.on('message', async (topic, payload) => {
                // this.console.log(topic);
                const pathParts = topic.split('/');
                if (pathParts.at(-1) !== 'config') {
                    // this.console.warn('unhandled autodiscovery topic', topic);
                    return;
                }

                // shift off prefix.
                pathParts.shift();
                const component = pathParts.shift();
                // remove node_id, it is unused
                if (pathParts.length > 2)
                    pathParts.shift();
                let objectId = pathParts.shift();

                const config = JSON.parse(payload.toString());

                objectId = config.unique_id || objectId;

                const type = typeMap.get(component);
                if (!type) {
                    // this.console.warn('unhandled component', component);
                    return;
                }

                this.console.log(topic, config);

                const nativeId = 'autodiscovered:' + this.nativeId + ':' + objectId;

                await deviceManager.onDeviceDiscovered({
                    providerNativeId: this.nativeId,
                    nativeId,
                    name: config.name,
                    interfaces: type.interfaces,
                    type: type.type,
                });

                const device = await this.getDevice(nativeId);
                device.storage.setItem('config', payload.toString());
                device.storage.setItem('component', component);
            });
        }
        catch (e) {
            this.console.error(e);
        }
    }

    async discoverDevices(duration: number): Promise<void> {
    }

    async getDevice(nativeId: string) {
        let ret = this.devices.get(nativeId);
        if (!ret) {
            ret = new MqttAutoDiscoveryDevice(nativeId, this);
            this.devices.set(nativeId, ret);
        }
        return ret;
    }

    async putSetting(key: string, value: string) {
        await super.putSetting(key, value);
        this.bind();
    }
}

export class MqttAutoDiscoveryDevice extends ScryptedDeviceBase implements OnOff, Brightness, Lock {
    messageListeners: ((topic: string, payload: Buffer) => void)[] = [];

    constructor(nativeId: string, public provider: MqttAutoDiscoveryProvider) {
        super(nativeId);
        if (this.storage.getItem('config'))
            this.bind();
    }

    eval(template: string, payload: Buffer): any {
        const value = nunjucks.renderString(template, {
            value_json: JSON.parse(payload.toString()),
        })
        return value;
    }

    bindMessage(topic: string, cb: (payload: Buffer) => void) {
        const listener = (messageTopic: string, payload: Buffer) => {
            if (topic !== messageTopic)
                return;
            cb(payload);
        };
        this.provider.client.on('message', listener);
        this.messageListeners.push(listener);
    }

    bind() {
        const { config } = this.loadComponentConfig();
        const { client } = this.provider;
        if (this.providedInterfaces.includes(ScryptedInterface.Brightness)) {
            client.subscribe(config.brightness_state_topic);
            this.bindMessage(config.brightness_state_topic,
                payload => this.brightness = this.eval(config.brightness_value_template, payload));
        }
        if (this.providedInterfaces.includes(ScryptedInterface.OnOff)) {
            client.subscribe(config.state_topic);
            this.bindMessage(config.brightness_state_topic,
                payload => this.on = (config.payload_on || 'ON') === this.eval(config.state_value_template, payload));
        }
    }

    loadComponentConfig() {
        return {
            type: this.storage.getItem('component'),
            config: JSON.parse(this.storage.getItem('config')),
        };
    }

    turn(config: any, payload: any) {
        this.publishValue(config.command_topic,
            config.brightness_value_template,
            payload);
    }

    publishValue(command_topic: string, template: string, value: any) {
        const payload = template ? nunjucks.renderString(template, {
            value_json: {
                value,
            }
        }) : value.toString();
        this.provider.client.publish(command_topic, Buffer.from(payload), {
            qos: 1,
            retain: true,
        });
    }

    async turnOff(): Promise<void> {
        const { config } = this.loadComponentConfig();
        if (config.on_command_type === 'brightness')
            return this.publishValue(config.brightness_command_topic,
                config.brightness_value_template, 0);
        return this.turn(config, config.payload_off)
    }
    async turnOn(): Promise<void> {
        const { config } = this.loadComponentConfig();
        if (config.on_command_type === 'brightness')
            return this.publishValue(config.brightness_command_topic,
                config.brightness_value_template, 255);
        return this.turn(config, config.payload_on)
    }
    async setBrightness(brightness: number): Promise<void> {
        const { config } = this.loadComponentConfig();
        this.publishValue(config.brightness_command_topic,
            config.brightness_value_template,
            Math.round(brightness / 100 * (config.brightness_scale || 100)));
    }
    async lock(): Promise<void> {
    }
    async unlock(): Promise<void> {
    }
}
