import crypto from 'crypto';
import { createScriptDevice, ScriptDeviceImpl, tsCompile } from '@scrypted/common/src/eval/scrypted-eval';
import sdk, { DeviceCreator, DeviceCreatorSettings, DeviceProvider, EventListenerRegister, MixinProvider, Scriptable, ScriptSource, ScryptedDevice, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedInterfaceDescriptors, Setting, Settings, WritableDeviceState } from '@scrypted/sdk';
import { StorageSettings } from "@scrypted/sdk/storage-settings"
import aedes, { AedesOptions } from 'aedes';
import fs from 'fs';
import http from 'http';
import { Client, connect } from 'mqtt';
import net from 'net';
import path from 'path';
import ws from 'websocket-stream';
import { SettingsMixinDeviceBase, SettingsMixinDeviceOptions } from "../../../common/src/settings-mixin";
import { MqttClient, MqttClientPublishOptions, MqttSubscriptions } from './api/mqtt-client';
import { MqttDeviceBase } from './api/mqtt-device-base';
import { MqttAutoDiscoveryProvider, publishAutoDiscovery } from './autodiscovery';
import { monacoEvalDefaults } from './monaco';
import { isPublishable } from './publishable-types';
import { scryptedEval } from './scrypted-eval';

export function filterExample(filename: string) {
    return fs.readFileSync(`examples/${filename}`).toString()
        .split('\n')
        .filter(line => !line.includes('SCRYPTED_FILTER_EXAMPLE_LINE'))
        .join('\n')
        .trim();
}

const MQTT_AUTODISCOVERY = 'MQTT Autodiscovery';
const loopbackLight = filterExample('loopback-light.ts');

const { log, deviceManager, systemManager } = sdk;

class MqttDevice extends MqttDeviceBase implements Scriptable {
    constructor(provider: MqttProvider, nativeId: string) {
        super(provider, nativeId);
    }

    async saveScript(source: ScriptSource): Promise<void> {
        this.storage.setItem('data', JSON.stringify(source));
        this.bind();
    }

    async loadScripts(): Promise<{ [filename: string]: ScriptSource; }> {
        try {
            const ret = JSON.parse(this.storage.getItem('data'));
            ret.monacoEvalDefaults = monacoEvalDefaults;
            ret.name = 'MQTT Handler';
            ret.script = ret.script || loopbackLight;
            return {
                'mqtt.ts': ret,
            };
        }
        catch (e) {
            return {
                'mqtt.ts': {
                    name: 'MQTT Handler',
                    script: loopbackLight,
                    monacoEvalDefaults,
                },
            }
        }
    }

    async bind() {
        const scripts = await this.loadScripts();
        const script = scripts['mqtt.ts'];
        await this.eval(script);
    }

    prepareScript() {
        const sd = createScriptDevice([
            ScryptedInterface.Scriptable,
            ScryptedInterface.Settings,
            '@scrypted/mqtt'
        ]);
        Object.assign(this, sd);
        return sd;
    }

    async eval(source: ScriptSource, variables?: {
        [name: string]:
        // package.json contains the metadata (name, interfaces) about this device
        // under the "scrypted" key.
        any;
    }): Promise<any> {
        const { script } = source;
        try {
            {
                const client = this.connectClient();
                client.on('connect', () => this.console.log('mqtt client connected'));
                client.on('disconnect', () => this.console.log('mqtt client disconnected'));
                client.on('error', e => {
                    this.console.log('mqtt client error', e);
                });
            }

            const sd = this.prepareScript();

            const mqtt: MqttClient & ScriptDeviceImpl = {
                subscribe: (subscriptions: MqttSubscriptions, options?: any) => {
                    for (const topic of Object.keys(subscriptions)) {
                        const fullTopic = this.pathname + topic;
                        const cb = subscriptions[topic];
                        if (options) {
                            this.client.subscribe(fullTopic, options)
                        }
                        else {
                            this.client.subscribe(fullTopic)
                        }
                        this.client.on('message', (messageTopic, message) => {
                            if (fullTopic !== messageTopic && fullTopic !== '/' + messageTopic)
                                return;
                            this.console.log('mqtt message', topic, message.toString());
                            cb({
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
                },
                publish: async (topic: string, value: any, options?: MqttClientPublishOptions) => {
                    if (typeof value === 'object')
                        value = JSON.stringify(value);
                    if (value.constructor.name !== Buffer.name)
                        value = value.toString();
                    this.client.publish(this.pathname + topic, value, options);
                },
                ...sd
            }

            const { defaultExport } = await scryptedEval(this, script, {
                mqtt,
            });

            await this.postRunScript(defaultExport);

            this.console.log('MQTT device started.');
        }
        catch (e) {
            this.log.a('There was an error starting the MQTT handler. Check the Console.');
            this.console.error(e);
        }
    }
}

const brokerProperties = ['httpPort', 'tcpPort', 'enableBroker', 'username', 'password', 'externalBroker'];


class MqttPublisherMixin extends SettingsMixinDeviceBase<any> {
    client: Client;
    handler: any;
    pathname: string;
    device: ScryptedDevice;
    listener: EventListenerRegister;

    constructor(public provider: MqttProvider, options: SettingsMixinDeviceOptions<any>) {
        super(options);

        this.device = systemManager.getDeviceById(this.id);
        try {
            this.connectClient();
        }
        catch (e) {
            this.console.error('error while connecting client.', e);
        }

        this.listener = this.device.listen(undefined, (eventSource, eventDetails, eventData) => {
            const { property } = eventDetails;
            if (property) {
                let str = this[property];
                if (typeof str === 'object')
                    str = JSON.stringify(str);

                this.client.publish(`${this.pathname}/${property}`, str?.toString() || '', {
                    retain: true,
                });
            }
            else {
                let str = eventData;
                if (typeof str === 'object')
                    str = JSON.stringify(str);

                this.client.publish(`${this.pathname}/${eventDetails.eventInterface}`, str?.toString() || '');
            }
        })
    }

    async getMixinSettings(): Promise<Setting[]> {
        return [
            {
                title: 'Publish URL',
                key: 'url',
                value: this.storage.getItem('url'),
                description: "The base publish URL for the device. All published MQTT data will use this as the base path. Leave blank to use the Scrypted MQTT broker.",
                placeholder: "mqtt://localhost/device/kitchen-light",
            },
            {
                title: 'Username',
                value: this.storage.getItem('username'),
                key: 'username',
                description: 'Optional: User name used to authenticate with the MQTT broker.',
            },
            {
                title: 'Password',
                value: this.storage.getItem('password'),
                key: 'password',
                type: 'password',
                description: 'Optional: Password used to authenticate with the MQTT broker.',
            },
        ];
    }

    async putMixinSetting(key: string, value: string | number | boolean) {
        if (key === 'url') {
            this.storage.setItem(key, value.toString());
        }
        else {
            this.storage.setItem(key, value.toString());
        }
        this.connectClient();
    }

    publishState(client: Client) {
        for (const iface of this.device.interfaces) {
            for (const prop of ScryptedInterfaceDescriptors[iface]?.properties || []) {
                let str = this[prop];
                if (typeof str === 'object')
                    str = JSON.stringify(str);

                client.publish(`${this.pathname}/${prop}`, str?.toString() || '');
            }
        }
    }

    connectClient() {
        this.client?.end();
        this.client = undefined;
        const urlString = this.storage.getItem('url');
        let url: URL;
        let username: string;
        let password: string;

        const externalBroker = this.provider.storage.getItem('externalBroker');
        if (urlString) {
            this.console.log('Using device specific broker.', urlString);
            url = new URL(urlString);
            username = this.storage.getItem('username') || undefined;
            password = this.storage.getItem('password') || undefined;
            this.pathname = url.pathname.substring(1);
        }
        else if (externalBroker && !this.provider.isBrokerEnabled) {
            this.console.log('Using external broker.', externalBroker);
            url = new URL(externalBroker);
            username = this.provider.storage.getItem('username') || undefined;
            password = this.provider.storage.getItem('password') || undefined;
            this.pathname = `${url.pathname.substring(1)}/${this.id}`;
        }
        else {
            this.console.log('Using built in broker.');
            const tcpPort = this.provider.storage.getItem('tcpPort') || '';
            url = new URL(`mqtt://localhost:${tcpPort}/scrypted`);
            username = this.provider.storage.getItem('username') || undefined;
            password = this.provider.storage.getItem('password') || undefined;
            this.pathname = `${url.pathname.substring(1)}/${this.id}`;
        }

        const urlWithoutPath = new URL(url);
        urlWithoutPath.pathname = '';

        const client = this.client = connect(urlWithoutPath.toString(), {
            rejectUnauthorized: false,
            username,
            password,
        });
        client.setMaxListeners(Infinity);

        const allProperties: string[] = [];
        const allMethods: string[] = [];
        for (const iface of this.device.interfaces) {
            const methods = ScryptedInterfaceDescriptors[iface]?.methods || [];
            allMethods.push(...methods);
            const properties = ScryptedInterfaceDescriptors[iface]?.properties || [];
            allProperties.push(...properties);
        }

        let found: ReturnType<typeof publishAutoDiscovery>;

        client.on('connect', packet => {
            this.console.log('MQTT client connected, publishing current state.');
            for (const method of allMethods) {
                client.subscribe(this.pathname + '/' + method);
            }

            found = publishAutoDiscovery(this.provider.storageSettings.values.mqttId, client, this, this.pathname, true, 'homeassistant');
            client.subscribe('homeassistant/status');
            this.publishState(client);
        });
        client.on('disconnect', () => this.console.log('mqtt client disconnected'));
        client.on('error', e => {
            this.console.log('mqtt client error', e);
        });

        client.on('message', async (messageTopic, message) => {
            if (messageTopic === 'homeassistant/status') {
                publishAutoDiscovery(this.provider.storageSettings.values.mqttId, client, this, this.pathname, false, 'homeassistant');
                this.publishState(client);
                return;
            }
            const method = messageTopic.substring(this.pathname.length + 1);
            if (!allMethods.includes(method)) {
                if (!allProperties.includes(method)) {
                    if (!found?.has(method)) {
                        this.console.warn('unknown topic', method);
                    }
                }
                return;
            }
            try {
                const args = JSON.parse(message.toString() || '[]');
                await this.device[method](...args);
            }
            catch (e) {
                this.console.warn('error invoking method', e);
            }
        });

        return this.client;
    }

    async release() {
        this.client?.end();
        this.client = undefined;
        this.listener?.removeListener();
        this.listener = undefined;
    }
}

export class MqttProvider extends ScryptedDeviceBase implements DeviceProvider, Settings, MixinProvider, DeviceCreator {
    devices = new Map<string, any>();
    netServer: net.Server;
    httpServer: http.Server;
    storageSettings = new StorageSettings(this, {
        mqttId: {
            group: 'Advanced',
            title: 'Autodiscovery ID',
            // hide: true,
            persistedDefaultValue: crypto.randomBytes(4).toString('hex'),
        }
    })

    constructor(nativeId?: string) {
        super(nativeId);

        this.systemDevice = {
            deviceCreator: 'MQTT Device',
        };

        this.maybeEnableBroker();

        for (const deviceId of deviceManager.getNativeIds()) {
            if (deviceId)
                this.getDevice(deviceId);
        }
    }

    async getCreateDeviceSettings(): Promise<Setting[]> {
        return [
            {
                key: 'name',
                title: 'Name',
                description: 'The name or description of the new script.',
            },
            {
                key: 'template',
                title: 'Template',
                description: 'The script template to use as a starting point.',
                value: MQTT_AUTODISCOVERY,
                choices: [
                    MQTT_AUTODISCOVERY,
                    ...fs.readdirSync('examples').filter(f => fs.statSync('examples/' + f).isFile()).map(f => path.basename(f)),
                ]
            }
        ]
    }

    async createDevice(settings: DeviceCreatorSettings): Promise<string> {
        let { name, template } = settings;
        name = name || 'New MQTT Device';
        if (!template || template === MQTT_AUTODISCOVERY)
            return this.newAutoDiscovery(name.toString());

        const nativeId = await this.newScriptDevice(name.toString(), filterExample(template.toString()));
        const device = await this.getDevice(nativeId) as MqttDevice;
        device.saveScript({
            script: filterExample(template.toString()),
        });

        return nativeId;
    }

    async getSettings(): Promise<Setting[]> {
        const ret: Setting[] = [
            {
                title: 'Enable MQTT Broker',
                key: 'enableBroker',
                description: 'Enable the built in Aedes MQTT Broker.',
                // group: 'MQTT Broker',
                type: 'boolean',
                value: (this.storage.getItem('enableBroker') === 'true').toString(),
            },
        ];

        if (!this.isBrokerEnabled) {
            ret.push(
                {
                    title: 'External Broker',
                    group: 'MQTT Broker',
                    key: 'externalBroker',
                    description: 'Specify the mqtt address of an external MQTT broker.',
                    placeholder: 'mqtt://192.168.1.100',
                    value: this.storage.getItem('externalBroker'),
                }
            )
        }

        ret.push(
            {
                group: 'MQTT Broker',
                title: 'Username',
                value: this.storage.getItem('username'),
                key: 'username',
                description: 'Optional: User name used to authenticate with the MQTT broker.',
            },
            {
                group: 'MQTT Broker',
                title: 'Password',
                value: this.storage.getItem('password'),
                key: 'password',
                type: 'password',
                description: 'Optional: Password used to authenticate with the MQTT broker.',
            }
        );

        if (this.isBrokerEnabled) {
            ret.push(
                {
                    title: 'TCP Port',
                    key: 'tcpPort',
                    description: 'The port to use for TCP connections',
                    placeholder: '1883',
                    type: 'number',
                    group: 'MQTT Broker',
                    value: this.storage.getItem('tcpPort'),
                },
                {
                    title: 'HTTP Port',
                    key: 'httpPort',
                    description: 'The port to use for HTTP connections',
                    placeholder: '8888',
                    type: 'number',
                    group: 'MQTT Broker',
                    value: this.storage.getItem('httpPort'),
                },
            );
        }

        ret.push(...await this.storageSettings.getSettings());
        return ret;
    }

    get isBrokerEnabled() {
        return this.storage.getItem('enableBroker') === 'true';
    }

    maybeEnableBroker() {
        this.httpServer?.close();
        this.netServer?.close();

        if (!this.isBrokerEnabled)
            return;

        if (this.storage.getItem('enableBroker') !== 'true')
            return;
        let opts: AedesOptions = undefined;
        const username = this.storage.getItem('username');
        const password = this.storage.getItem('password');
        if (username && password) {
            opts = {
                authenticate(client, u, p, done) {
                    done(undefined, username === u && password === p.toString());
                }
            }
        }
        const instance = aedes(opts);
        this.netServer = net.createServer(instance.handle);
        const tcpPort = parseInt(this.storage.getItem('tcpPort')) || 1883;
        const httpPort = parseInt(this.storage.getItem('httpPort')) || 8888;
        this.netServer.listen(tcpPort);
        this.httpServer = http.createServer();
        ws.createServer({ server: this.httpServer }).on('connection', instance.handle);
        this.httpServer.listen(httpPort);

        instance.on('publish', packet => {
            if (!packet.payload)
                return;
            const preview = packet.payload.length > 2048 ? '[large payload suppressed]' : packet.payload.toString();
            this.console.log('mqtt message', packet.topic, preview);
        });
    }

    async newAutoDiscovery(name: string) {
        // generate a random id
        var nativeId = 'autodiscovery:' + Math.random().toString();

        await deviceManager.onDeviceDiscovered({
            nativeId,
            name: name,
            interfaces: [ScryptedInterface.DeviceProvider, ScryptedInterface.Settings],
            type: ScryptedDeviceType.DeviceProvider,
        });

        var text = `New MQTT Autodiscovery ${name} ready. Check the notification area to continue configuration.`;
        log.a(text);
        log.clearAlert(text);
        return nativeId;
    }

    async newScriptDevice(name: string, contents: string) {
        // generate a random id
        var nativeId = Math.random().toString();
        await deviceManager.onDeviceDiscovered({
            nativeId,
            name: name,
            interfaces: [ScryptedInterface.Scriptable,
            ScryptedInterface.Settings,
                '@scrypted/mqtt'
            ],
            type: ScryptedDeviceType.Unknown,
        });

        var text = `New MQTT Device ${name} ready. Check the notification area to continue configuration.`;
        log.a(text);
        log.clearAlert(text);
        return nativeId;
    }

    async putSetting(key: string, value: string | number) {
        if (this.storageSettings.keys[key]) {
            return this.storageSettings.putSetting(key, value);
        }
        this.storage.setItem(key, value.toString());

        if (brokerProperties.includes(key)) {
            this.maybeEnableBroker();
            this.onDeviceEvent(ScryptedInterface.Settings, undefined);
            return;
        }
    }

    async discoverDevices(duration: number) {
    }

    async releaseDevice(id: string, nativeId: string): Promise<void> {

    }

    createMqttDevice(nativeId: string): MqttDevice {
        return;
    }

    async getDevice(nativeId: string) {
        let ret = this.devices.get(nativeId);
        if (!ret) {
            if (nativeId.startsWith('autodiscovery:')) {
                ret = new MqttAutoDiscoveryProvider(this, nativeId);
            }
            else if (nativeId.startsWith('0.')) {
                ret = new MqttDevice(this, nativeId);
                await ret.bind();
            }
            if (ret)
                this.devices.set(nativeId, ret);
        }
        return ret;
    }


    async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
        if (interfaces.includes('@scrypted/mqtt'))
            return;
        return isPublishable(type, interfaces) ? [ScryptedInterface.Settings] : undefined;
    }

    async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: WritableDeviceState): Promise<any> {
        return new MqttPublisherMixin(this, {
            mixinDevice,
            mixinDeviceState,
            mixinDeviceInterfaces,
            mixinProviderNativeId: this.nativeId,
            group: 'MQTT',
            groupKey: 'mqtt',
        });
    }

    async releaseMixin(id: string, mixinDevice: any): Promise<void> {
        mixinDevice.release();
    }
}

export default MqttProvider;


export async function fork() {
    return {
        tsCompile,
    }
}
