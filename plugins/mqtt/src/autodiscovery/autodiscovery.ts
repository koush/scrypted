import { Brightness, DeviceProvider, Lock, LockState, OnOff, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting, Settings } from "@scrypted/sdk";
import { MqttClient, connect } from "mqtt";
import { MqttDeviceBase } from "../api/mqtt-device-base";
import nunjucks from 'nunjucks';
import sdk from "@scrypted/sdk";

const { deviceManager } = sdk;

interface Component {
    getInterfaces?(config: any): string[];
    interfaces?: string[];
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
typeMap.set('binary_sensor', {
    getInterfaces(config: any) {
        if (config.device_class === 'motion')
            return [ScryptedInterface.MotionSensor];
        if (config.device_class === 'door' || config.device_class === 'garage_door' || config.device_class === 'window')
            return [ScryptedInterface.EntrySensor];
    },
    type: ScryptedDeviceType.Sensor,
});

// https://www.home-assistant.io/integrations/light.mqtt/#json-schema
// {
//   "brightness": 255,
//   "color_mode": "rgb",
//   "color_temp": 155,
//   "color": {
//     "r": 255,
//     "g": 180,
//     "b": 200,
//     "c": 100,
//     "w": 50,
//     "x": 0.406,
//     "y": 0.301,
//     "h": 344.0,
//     "s": 29.412
//   },
//   "effect": "colorloop",
//   "state": "ON",
//   "transition": 2,
// }

export class MqttAutoDiscoveryProvider extends MqttDeviceBase implements DeviceProvider {
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
                let nodeId: string;
                if (pathParts.length > 2)
                    nodeId = pathParts.shift();
                let objectId = pathParts.shift();

                const config = JSON.parse(payload.toString());

                const nativeIdSuffix = component + '/' + (nodeId || config.unique_id || objectId);

                const type = typeMap.get(component);
                if (!type) {
                    // this.console.warn('unhandled component', component);
                    return;
                }

                this.console.log(topic, config);

                const nativeId = 'autodiscovered:' + this.nativeId + ':' + nativeIdSuffix;

                let deviceInterfaces: string[];
                if (type.interfaces)
                    deviceInterfaces = type.interfaces;
                else
                    deviceInterfaces = type.getInterfaces(config);

                if (!deviceInterfaces)
                    return;

                let interfaces = [
                    '@scrypted/mqtt',
                ];
                interfaces.push(...deviceInterfaces);
                // try combine into existing device if this mqtt device presents
                // a node id, which may imply multiple interfaces.
                if (nodeId && deviceManager.getNativeIds().includes(nativeId)) {
                    const existing = await this.getDevice(nativeId, true);
                    const allInterfaces = [];
                    allInterfaces.push(...existing.providedInterfaces, ...interfaces);
                    interfaces = allInterfaces;
                }

                await deviceManager.onDeviceDiscovered({
                    providerNativeId: this.nativeId,
                    nativeId,
                    name: config.device?.name || nodeId || config.name,
                    interfaces,
                    type: type.type,
                    info: {
                        manufacturer: config.device?.manufacturer,
                        model: config.device?.model,
                        firmware: config.device?.sw_version,
                    },
                });

                const device = await this.getDevice(nativeId, true);
                let configs = {};
                try {
                    configs = JSON.parse(device.storage.getItem('configs'));
                }
                catch (e) {
                }
                for (const iface of deviceInterfaces) {
                    configs[iface] = config;
                }
                try {
                    device.storage.setItem('configs', JSON.stringify(configs));
                    device.storage.setItem('component', component);
                    device.bind();
                }
                catch (e) {
                    device.console.error('bind error', e);
                }
            });
        }
        catch (e) {
            this.console.error(e);
        }

        const prefix = 'autodiscovered:' + this.nativeId + ':';
        for (const check of deviceManager.getNativeIds()) {
            if (!check?.startsWith(prefix))
                continue;
            this.getDevice(check);
        }
    }

    async discoverDevices(duration: number): Promise<void> {
    }

    async getDevice(nativeId: string, noBind?: boolean) {
        let ret = this.devices.get(nativeId);
        if (!ret) {
            ret = new MqttAutoDiscoveryDevice(nativeId, this, noBind);
            this.devices.set(nativeId, ret);
        }
        return ret;
    }

    async releaseDevice(id: string, nativeId: string): Promise<void> {
        
    }

    async putSetting(key: string, value: string) {
        await super.putSetting(key, value);
        this.bind();
    }
}

function scaleBrightness(scryptedBrightness: number, brightnessScale: number) {
    brightnessScale = brightnessScale || 255;
    return Math.round(scryptedBrightness * brightnessScale / 100);
}

function unscaleBrightness(mqttBrightness: number, brightnessScale: number) {
    brightnessScale = brightnessScale || 255;
    return Math.round(mqttBrightness * 100 / brightnessScale);
}

export class MqttAutoDiscoveryDevice extends ScryptedDeviceBase implements OnOff, Brightness, Lock {
    messageListeners: ((topic: string, payload: Buffer) => void)[] = [];

    constructor(nativeId: string, public provider: MqttAutoDiscoveryProvider, noBind?: boolean) {
        super(nativeId);
        const configs = this.storage.getItem('configs');
        if (!configs) {
            this.console.warn('no config');
            return;
        }
        this.console.log('configs', configs);
        if (noBind) {
            this.console.warn('delayed bind')
            return;
        }
        this.bind();
    }

    eval(template: string, payload: Buffer): any {
        const value = nunjucks.renderString(template, {
            value_json: JSON.parse(payload.toString()),
        })
        return value;
    }

    bindMessage(topic: string, cb: (payload: Buffer) => void) {
        this.console.log('subscribing', topic);
        const listener = (messageTopic: string, payload: Buffer) => {
            if (topic !== messageTopic)
                return;
            this.console.log('message', topic, payload?.toString());
            try {
                cb(payload);
            }
            catch (e) {
                this.console.error('callback error', e);
            }
        };
        this.provider.client.on('message', listener);
        this.messageListeners.push(listener);
    }

    bind() {
        this.console.log('binding...');
        const { client } = this.provider;
        if (this.providedInterfaces.includes(ScryptedInterface.Brightness)) {
            const config = this.loadComponentConfig(ScryptedInterface.Brightness);
            const brightnessStateTopic = config.brightness_state_topic || config.state_topic;
            client.subscribe(brightnessStateTopic);
            this.bindMessage(brightnessStateTopic,
                payload => this.brightness =
                    unscaleBrightness(this.eval(config.brightness_value_template || '{{ value_json.brightness }}', payload), config.brightness_scale));
        }
        if (this.providedInterfaces.includes(ScryptedInterface.OnOff)) {
            const config = this.loadComponentConfig(ScryptedInterface.OnOff);
            client.subscribe(config.state_topic);
            this.bindMessage(config.state_topic,
                payload => this.on =
                    (config.payload_on || 'ON') === this.eval(config.state_value_template || '{{ value_json.state }}', payload));
        }
        if (this.providedInterfaces.includes(ScryptedInterface.Lock)) {
            const config = this.loadComponentConfig(ScryptedInterface.Lock);
            client.subscribe(config.state_topic);
            this.bindMessage(config.state_topic,
                payload => {
                    this.lockState = (config.state_locked || 'LOCKED') === this.eval(config.state_value_template, payload)
                        ? LockState.Locked : LockState.Unlocked;
                });
        }
        if (this.providedInterfaces.includes(ScryptedInterface.EntrySensor)) {
            const config = this.loadComponentConfig(ScryptedInterface.EntrySensor);
            client.subscribe(config.state_topic);
            this.bindMessage(config.state_topic,
                payload => this.entryOpen = config.payload_on === this.eval(config.value_template, payload));
        }
        if (this.providedInterfaces.includes(ScryptedInterface.MotionSensor)) {
            const config = this.loadComponentConfig(ScryptedInterface.MotionSensor);
            client.subscribe(config.state_topic);
            this.bindMessage(config.state_topic,
                payload => this.motionDetected = config.payload_on === this.eval(config.value_template, payload));
        }
    }

    loadComponentConfig(iface: ScryptedInterface) {
        const configs = JSON.parse(this.storage.getItem('configs'));
        return configs[iface];
    }

    publishValue(command_topic: string, template: string, value: any, defaultValue: any) {
        if (value == null)
            value = defaultValue;
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
        const config = this.loadComponentConfig(ScryptedInterface.OnOff);
        if (config.on_command_type === 'brightness')
            return this.publishValue(config.brightness_command_topic,
                config.brightness_value_template, 0, 0);
        return this.publishValue(config.command_topic,
            config.brightness_value_template,
            config.payload_off, 'OFF');
    }

    async turnOn(): Promise<void> {
        const config = this.loadComponentConfig(ScryptedInterface.OnOff);
        if (config.on_command_type === 'brightness')
            return this.publishValue(config.brightness_command_topic,
                config.brightness_value_template,
                config.brightness_scale || 255,
                config.brightness_scale || 255);
        return this.publishValue(config.command_topic,
            config.brightness_value_template,
            config.payload_on, 'ON');
    }
    async setBrightness(brightness: number): Promise<void> {
        const config = this.loadComponentConfig(ScryptedInterface.Brightness);
        const scaledBrightness = scaleBrightness(brightness, config.brightness_scale);
        this.publishValue(config.brightness_command_topic,
            config.brightness_value_template,
            scaledBrightness, scaledBrightness);
    }
    async lock(): Promise<void> {
        const config = this.loadComponentConfig(ScryptedInterface.Lock);
        return this.publishValue(config.command_topic,
            config.value_template, config.payload_lock, 'LOCK');
    }
    async unlock(): Promise<void> {
        const config = this.loadComponentConfig(ScryptedInterface.Lock);
        return this.publishValue(config.command_topic,
            config.value_template, config.payload_unlock, 'UNLOCK');
    }
}
