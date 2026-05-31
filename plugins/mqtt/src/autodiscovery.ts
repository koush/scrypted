import crypto from 'crypto';
import { Online, Brightness, ColorSettingHsv, ColorSettingTemperature, DeviceProvider, Lock, LockState, MixinDeviceBase, OnOff, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedInterfaceProperty } from "@scrypted/sdk";
import { Client, MqttClient, connect } from "mqtt";
import { MqttDeviceBase } from "./api/mqtt-device-base";
import nunjucks from 'nunjucks';
import sdk from "@scrypted/sdk";
import type { MqttProvider } from './main';
import { getHsvFromXyColor, getXyYFromHsvColor } from './color-util';
import { MqttEvent } from './api/mqtt-client';

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
    getInterfaces(config: any) {
        const interfaces = [ScryptedInterface.OnOff, ScryptedInterface.Brightness];
        if (config.color_mode) {
            config.supported_color_modes.forEach(color_mode => {
                if (color_mode === 'xy')
                    interfaces.push(ScryptedInterface.ColorSettingHsv);
                else if (color_mode === 'hs')
                    interfaces.push(ScryptedInterface.ColorSettingHsv);
                else if (color_mode === 'color_temp')
                    interfaces.push(ScryptedInterface.ColorSettingTemperature);
            });
        }
        return interfaces;
    },
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

    constructor(provider: MqttProvider, nativeId: string) {
        super(provider, nativeId);

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

                let deviceInterfaces: string[]
                if (type.interfaces)
                    deviceInterfaces = type.interfaces;
                else
                    deviceInterfaces = type.getInterfaces(config);

                if (!deviceInterfaces)
                    return;

                deviceInterfaces.push(ScryptedInterface.Online);

                let interfaces = [
                    '@scrypted/mqtt'
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

function getMiredFromKelvin(kelvin: number) {
    return Math.round(1000000 / kelvin);
}

function getKelvinFromMired(mired: number) {
    return Math.round(1000000 / mired);
}

function unscaleBrightness(mqttBrightness: number, brightnessScale: number) {
    brightnessScale = brightnessScale || 255;
    return Math.round(mqttBrightness * 100 / brightnessScale);
}

export class MqttAutoDiscoveryDevice extends ScryptedDeviceBase implements Online, OnOff, Brightness, Lock, ColorSettingTemperature, ColorSettingHsv {
    messageListeners: ((topic: string, payload: Buffer) => void)[] = [];
    debounceCallbacks: Map<string, Set<(payload: Buffer) => void>>;
    modelId: any;
    xyY: { x: number; y: number; brightness: number; };
    colorMode: string;


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

        this.debounceCallbacks = new Map<string, Set<(payload: Buffer) => void>>();

        const { client } = provider;
        client.on('message', this.listener.bind(this));
        this.messageListeners.push(this.listener.bind(this));

        this.bind();
    }

    eval(template: string, payload: Buffer): any {
        const value = nunjucks.renderString(template, {
            value_json: JSON.parse(payload.toString()),
        })
        return value;
    }

    bindMessage(topic: string, cb: (payload: Buffer) => void) {
        let set: Set<(payload: Buffer) => void> = this.debounceCallbacks.get(topic);
        if (set) {
            this.console.log('subscribing', topic);

            set.add(cb);
        } else {
            this.console.log('subscribing to new topic', topic);

            set = new Set([cb]);
            this.debounceCallbacks.set(topic, set);
        }
    }

    listener(topic: string, payload: Buffer) {
        let set = this.debounceCallbacks?.get(topic);

        if (!set)
            return;

        this.console.log('message', topic, payload?.toString());
        try {
            set.forEach(callback => {
                callback(payload);
            });
        }
        catch (e) {
            this.console.error('callback error', e);
        }
    }

    bind() {
        this.console.log('binding...');
        const { client } = this.provider;

        this.debounceCallbacks = new Map<string, Set<(payload: Buffer) => void>>();

        if (this.providedInterfaces.includes(ScryptedInterface.Online)) {
            const config = this.loadComponentConfig(ScryptedInterface.Online);
            if (config.availability && config.availability.length > 0) {
                const availabilityTopic = config.availability[0].topic;
                client.subscribe(availabilityTopic);
                this.bindMessage(availabilityTopic,
                    payload => this.online =
                        (config.payload_on || 'online') === this.eval(config.availability[0].value_template || '{{ value_json.state }}', payload));
            }
        }
        if (this.providedInterfaces.includes(ScryptedInterface.ColorSettingHsv)) {
            const config = this.loadComponentConfig(ScryptedInterface.ColorSettingHsv);
            const colorStateTopic = config.hs_state_topic || config.state_topic;
            client.subscribe(colorStateTopic);
            this.bindMessage(colorStateTopic,
                payload => {
                    let obj = JSON.parse(payload.toString());

                    // exit updating the below because the user set the color_temp
                    if (obj.color_mode !== "xy" && obj.color_mode !== "hs") {
                        this.hsv = undefined;
                        return;
                    }

                    // handle hs_value_template if present
                    if (config.hs_value_template) {
                        this.hsv = this.eval(config.hs_value_template, payload);
                        return;
                    }

                    // handle xy_value_template if present
                    if (config.xy_value_template) {
                        var xy = this.eval(config.xy_value_template, payload);
                        this.hsv = getHsvFromXyColor(xy.x, xy.y, this.xyY?.brightness ?? 1);
                        return;
                    }

                    let color = obj.color;
                    this.modelId = obj.device?.model;

                    // handle color_mode hs if present
                    if (color.h !== undefined && color.s !== undefined) {
                        this.colorMode = "hs";

                        // skip update if the colors match
                        if (color.h === this.hsv.h && color.s === this.hsv.s)
                            return;

                        const brightness = unscaleBrightness(obj.brightness, config.brightness_scale);
                        this.hsv = {
                            h: color.h,
                            s: color.s,
                            v: brightness
                        };
                        return;
                    }

                    // handle color_mode xy if present
                    if (color.x !== undefined && color.y !== undefined) {
                        this.colorMode = "xy";

                        const hsv = getHsvFromXyColor(color.x, color.y, this.xyY?.brightness ?? 100);
                        this.hsv = {
                            h: hsv.h,
                            s: hsv.s,
                            v: hsv.v
                        };
                        return;
                    }
                });
        }
        if (this.providedInterfaces.includes(ScryptedInterface.ColorSettingTemperature)) {
            const config = this.loadComponentConfig(ScryptedInterface.ColorSettingTemperature);
            const colorTempStateTopic = config.color_temp_command_topic || config.state_topic;
            client.subscribe(colorTempStateTopic);
            this.bindMessage(colorTempStateTopic,
                payload => {
                    let obj = JSON.parse(payload.toString());

                    // exit updating the below because the user set the color_temp
                    if (obj.color_mode !== "color_temp") {
                        this.colorTemperature = undefined;
                        return;
                    }

                    if (config.color_temp_value_template) {
                        this.colorTemperature = this.eval(config.color_temp_value_template, payload);
                        return;
                    }

                    this.colorTemperature = getKelvinFromMired(obj.color_temp);
                });
        }
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
        }) : JSON.stringify(value);

        this.provider.client.publish(command_topic, Buffer.from(payload), {
            qos: 1,
            retain: true,
        });
    }

    async turnOff(): Promise<void> {
        const config = this.loadComponentConfig(ScryptedInterface.OnOff);

        if (config.on_command_type === 'brightness') {
            await this.setBrightnessInternal(0, config);
            return;
        }

        let command = {
            state: "OFF"
        };

        if (config.command_off_template) {
            this.publishValue(config.command_topic,
                config.command_off_template,
                command, "ON");
        } else {
            this.publishValue(config.command_topic,
                undefined, command, command);
        }
    }
    async turnOn(): Promise<void> {
        const config = this.loadComponentConfig(ScryptedInterface.OnOff);

        if (config.on_command_type === 'brightness') {
            await this.setBrightnessInternal(config.brightness_scale || 255, config);
            return;
        }

        let command = {
            state: "ON"
        };

        if (config.command_on_template) {
            this.publishValue(config.command_topic,
                config.command_on_template,
                command, "ON");
        } else {
            this.publishValue(config.command_topic,
                undefined, command, command);
        }
    }
    async setBrightness(brightness: number): Promise<void> {
        const config = this.loadComponentConfig(ScryptedInterface.Brightness);
        await this.setBrightnessInternal(brightness, config);
    }
    async setBrightnessInternal(brightness: number, config: any): Promise<void> {
        const scaledBrightness = scaleBrightness(brightness, config.brightness_scale);

        // use brightness_command_topic and fallback to JSON if not provided
        if (config.brightness_value_template) {
            this.publishValue(config.brightness_command_topic,
                config.brightness_value_template,
                scaledBrightness, scaledBrightness);
        } else {
            this.publishValue(config.command_topic,
                `{ "state": "${scaledBrightness === 0 ? 'OFF' : 'ON'}", "brightness": ${scaledBrightness} }`,
                scaledBrightness, 255);
        }
    }
    async getTemperatureMaxK(): Promise<number> {
        const config = this.loadComponentConfig(ScryptedInterface.ColorSettingTemperature);
        return getKelvinFromMired(Math.min(config.min_mireds, config.max_mireds));
    }
    async getTemperatureMinK(): Promise<number> {
        const config = this.loadComponentConfig(ScryptedInterface.ColorSettingTemperature);
        return getKelvinFromMired(Math.max(config.min_mireds, config.max_mireds));
    }
    async setColorTemperature(kelvin: number): Promise<void> {
        const config = this.loadComponentConfig(ScryptedInterface.ColorSettingTemperature);

        if (kelvin >= 0 || kelvin <= 100) {
            const min = await this.getTemperatureMinK();
            const max = await this.getTemperatureMaxK();
            const diff = (max - min) * (kelvin / 100);
            kelvin = Math.round(min + diff);
        }

        const mired = getMiredFromKelvin(kelvin);
        const color = {
            state: "ON",
            //color_mode: "color_temp",
            color_temp: mired ?? 370
        };

        // use color_temp_command_topic and fallback to JSON if not provided
        if (config.color_temp_command_template) {
            this.publishValue(config.color_temp_command_topic,
                config.color_temp_command_template,
                color, color);
        } else {
            this.publishValue(config.command_topic,
                undefined, color, color);
        }
    }
    async setHsv(hue: number, saturation: number, value: number): Promise<void> {
        const config = this.loadComponentConfig(ScryptedInterface.ColorSettingHsv);

        this.colorMode = this.colorMode ?? (config.supported_color_modes.includes("hs") ? "hs" : "xy");

        if (this.colorMode === "hs") {
            const color = {
                state: "ON",
                //color_mode: "hs",
                color: {
                    h: hue ?? 0,
                    s: (saturation ?? 1) * 100
                }
            };

            // use hs_command_topic and fallback to JSON if not provided
            if (config.hs_command_template) {
                this.publishValue(config.hs_command_topic,
                    config.hs_command_template,
                    color, color);
            } else {
                this.publishValue(config.command_topic,
                    undefined, color, color);
            }
        } else if (this.colorMode === "xy") {
            const xy = getXyYFromHsvColor(hue, saturation, value, this.modelId);
            const color = {
                state: "ON",
                //color_mode: "xy",
                color: {
                    x: xy.x,
                    y: xy.y
                }
            };

            this.xyY = xy;

            // use xy_command_template and fallback to JSON if not provided
            if (config.xy_command_template) {
                this.publishValue(config.xy_command_topic,
                    config.xy_command_template,
                    color, color);
            } else {
                this.publishValue(config.command_topic,
                    undefined, color, color);
            }
        }
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

interface AutoDiscoveryConfig {
    component: string;
    create: (mqttId: string, device: MixinDeviceBase<any>, topic: string) => any;
    subscriptions?: {
        [topic: string]: (device: MixinDeviceBase<any>, event: MqttEvent) => void;
    }
}

const autoDiscoveryMap = new Map<string, AutoDiscoveryConfig>();

function getAutoDiscoveryDevice(device: MixinDeviceBase<any>, mqttId: string) {
    return {
        dev: {
            name: device.name,
            // what the hell is this
            "ids": crypto.createHash('sha256').update(`scrypted-${mqttId}-${device.id}`).digest().toString('hex').substring(0, 8),
            "sw": device.info?.version,
            "mdl": device.info?.model,
            "mf": device.info?.manufacturer,
        },
    }
}

function createBinarySensorConfig(mqttId: string, device: MixinDeviceBase<any>, prop: ScryptedInterfaceProperty, topic: string) {
    return {
        state_topic: `${topic}/${prop}`,
        payload_on: 'true',
        payload_off: 'false',
        ...getAutoDiscoveryDevice(device, mqttId),
    }
}

function addBinarySensor(iface: ScryptedInterface, prop: ScryptedInterfaceProperty) {
    autoDiscoveryMap.set(iface, {
        component: 'binary_sensor',
        create(mqttId, device, topic) {
            return createBinarySensorConfig(mqttId, device, prop, topic);
        }
    });
}

addBinarySensor(ScryptedInterface.MotionSensor, ScryptedInterfaceProperty.motionDetected);
addBinarySensor(ScryptedInterface.BinarySensor, ScryptedInterfaceProperty.binaryState);
addBinarySensor(ScryptedInterface.OccupancySensor, ScryptedInterfaceProperty.occupied);
addBinarySensor(ScryptedInterface.FloodSensor, ScryptedInterfaceProperty.flooded);
addBinarySensor(ScryptedInterface.AudioSensor, ScryptedInterfaceProperty.audioDetected);
addBinarySensor(ScryptedInterface.Online, ScryptedInterfaceProperty.online);

autoDiscoveryMap.set(ScryptedInterface.Thermometer, {
    component: 'sensor',
    create(mqttId, device, topic) {
        return {
            state_topic: `${topic}/${ScryptedInterfaceProperty.temperature}`,
            value_template: '{{ value_json }}',
            unit_of_measurement: 'C',
            ...getAutoDiscoveryDevice(device, mqttId),
        }
    }
});

autoDiscoveryMap.set(ScryptedInterface.HumiditySensor, {
    component: 'sensor',
    create(mqttId, device, topic) {
        return {
            state_topic: `${topic}/${ScryptedInterfaceProperty.humidity}`,
            value_template: '{{ value_json }}',
            unit_of_measurement: '%',
            ...getAutoDiscoveryDevice(device, mqttId),
        }
    }
});

autoDiscoveryMap.set(ScryptedInterface.OnOff, {
    component: 'switch',
    create(mqttId, device, topic) {
        return {
            payload_on: 'true',
            payload_off: 'false',
            state_topic: `${topic}/${ScryptedInterfaceProperty.on}`,
            command_topic: `${topic}/${ScryptedInterfaceProperty.on}/set`,
            ...getAutoDiscoveryDevice(device, mqttId),
        }
    },
    subscriptions: {
        'on/set': (device, event) => {
            const d = sdk.systemManager.getDeviceById<OnOff>(device.id);
            if (event.json)
                d.turnOn();
            else
                d.turnOff();
        }
    },
});

export function publishAutoDiscovery(mqttId: string, client: Client, device: MixinDeviceBase<any>, topic: string, subscribe: boolean, autoDiscoveryPrefix = 'homeassistant') {
    const subs = new Set<string>();

    for (const iface of device.interfaces) {
        const found = autoDiscoveryMap.get(iface);
        if (!found)
            continue;

        const config = found.create(mqttId, device, topic);
        const nodeId = `scrypted-${mqttId}-${device.id}`;
        config.unique_id = `scrypted-${mqttId}-${device.id}-${iface}`;
        config.name = iface;

        const configTopic = `${autoDiscoveryPrefix}/${found.component}/${nodeId}/${iface}/config`;
        client.publish(configTopic, JSON.stringify(config), {
            retain: true,
        });

        if (subscribe) {
            const subscriptions = found.subscriptions || {};
            for (const subscriptionTopic of Object.keys(subscriptions || {})) {
                subs.add(subscriptionTopic);

                const fullTopic = topic + '/' + subscriptionTopic;
                const cb = subscriptions[subscriptionTopic];
                client.subscribe(fullTopic)
                client.on('message', (messageTopic, message) => {
                    if (fullTopic !== messageTopic && fullTopic !== '/' + messageTopic)
                        return;
                    device.console.log('mqtt message', subscriptionTopic, message.toString());
                    cb(device, {
                        get text() {
                            return message.toString();
                        },
                        get json() {
                            try {
                                return JSON.parse(message.toString());
                            }
                            catch (e) {
                            }
                        },
                        get buffer() {
                            return message;
                        }
                    })
                });
            }
        }
    }

    return subs;
}
