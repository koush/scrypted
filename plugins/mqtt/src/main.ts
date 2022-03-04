// https://developer.scrypted.app/#getting-started
// package.json contains the metadata (name, interfaces) about this device
// under the "scrypted" key.
import { Settings, Setting, DeviceProvider, ScryptedDeviceBase, ScryptedInterface, ScryptedDeviceType, Scriptable, ScriptSource, ScryptedInterfaceDescriptors, MixinProvider, ScryptedDevice, EventListenerRegister } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import { monacoEvalDefaults } from './monaco';
import { scryptedEval } from './scrypted-eval';
import { MqttClient, MqttSubscriptions } from './api/mqtt-client';
import aedes, { AedesOptions } from 'aedes';
import net from 'net';
import ws from 'websocket-stream';
import http from 'http';
import { MqttDeviceBase } from './api/mqtt-device-base';
import { MqttAutoDiscoveryProvider } from './autodiscovery/autodiscovery';
import { SettingsMixinDeviceBase, SettingsMixinDeviceOptions } from "../../../common/src/settings-mixin";
import { connect, Client } from 'mqtt';
import { isPublishable } from './publishable-types';
import { createScriptDevice, ScriptDeviceImpl } from '@scrypted/common/src/eval/scrypted-eval';

const loopbackLight = require("!!raw-loader!./examples/loopback-light.ts").default;

const { log, deviceManager, systemManager } = sdk;

class MqttDevice extends MqttDeviceBase implements Scriptable {
    constructor(nativeId: string) {
        super(nativeId);

        this.bind();
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

    async eval(source: ScriptSource, variables?: {
        [name: string]:
        // package.json contains the metadata (name, interfaces) about this device
        // under the "scrypted" key.
        any;
    }): Promise<any> {
        const { script } = source;
        try {
            const client = this.connectClient();
            client.on('connect', () => this.console.log('mqtt client connected'));
            client.on('disconnect', () => this.console.log('mqtt client disconnected'));
            client.on('error', e => {
                this.console.log('mqtt client error', e);
            });

            const mqtt: MqttClient & ScriptDeviceImpl = {
                subscribe: (subscriptions: MqttSubscriptions, options?: any) => {
                    for (const topic of Object.keys(subscriptions)) {
                        const fullTopic = this.pathname + topic;
                        const cb = subscriptions[topic];
                        if (options) {
                            client.subscribe(fullTopic, options)
                        }
                        else {
                            client.subscribe(fullTopic)
                        }
                        client.on('message', (messageTopic, message) => {
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
                publish: async (topic: string, value: any) => {
                    if (typeof value === 'object')
                        value = JSON.stringify(value);
                    if (value.constructor.name !== Buffer.name)
                        value = value.toString();
                    client.publish(this.pathname + topic, value);
                },
                ...createScriptDevice([
                    ScryptedInterface.Scriptable,
                    ScryptedInterface.Settings,
                ])
            }
            await scryptedEval(this, script, {
                mqtt,
            });

            const allInterfaces = mqtt.mergeHandler(this);

            await deviceManager.onDeviceDiscovered({
                nativeId: this.nativeId,
                interfaces: allInterfaces,
                type: ScryptedDeviceType.Unknown,
                name: this.providedName,
            });

            this.console.log('MQTT device started.');
        }
        catch (e) {
            this.log.a('There was an error starting the MQTT handler. Check the Console.');
            this.console.error(e);
        }
    }
}

const brokerProperties = ['httpPort', 'tcpPort', 'enableBroker', 'username', 'password'];


class MqttPublisherMixin extends SettingsMixinDeviceBase<any> {
    client: Client;
    handler: any;
    pathname: string;
    device: ScryptedDevice;
    listener: EventListenerRegister;

    constructor(public provider: MqttProvider, options: SettingsMixinDeviceOptions<any>) {
        super(options);

        this.device = systemManager.getDeviceById(this.id);
        this.connectClient();

        this.listener = this.device.listen(undefined, (eventSource, eventDetails, eventData) => {
            const { property } = eventDetails;
            if (property) {
                let str = this[property];
                if (typeof str === 'object')
                    str = JSON.stringify(str);

                this.client.publish(`${this.pathname}/${this.id}/${property}`, str?.toString() || '');
            }
            else {
                let str = eventData;
                if (typeof str === 'object')
                    str = JSON.stringify(str);

                this.client.publish(`${this.pathname}/${this.id}/${eventDetails.eventInterface}`, str?.toString() || '');
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
            let url = value.toString();
            if (!url.endsWith('/'))
                url += '/';
            this.storage.setItem(key, url);
        }
        else {
            this.storage.setItem(key, value.toString());
        }
    }

    connectClient() {
        this.client?.end();
        this.client = undefined;
        const urlString = this.storage.getItem('url');
        let url: URL;
        let username: string;
        let password: string;
        if (urlString) {
            url = new URL(urlString);
            username = this.storage.getItem('username') || undefined;
            password = this.storage.getItem('password') || undefined;
        }
        else {
            const tcpPort = this.provider.storage.getItem('tcpPort') || '';
            username = this.provider.storage.getItem('username') || undefined;
            password = this.provider.storage.getItem('password') || undefined;
            url = new URL(`mqtt://localhost:${tcpPort}/scrypted`);
        }

        this.pathname = url.pathname.substring(1);
        const urlWithoutPath = new URL(url);
        urlWithoutPath.pathname = '';

        const client = this.client = connect(urlWithoutPath.toString(), {
            username,
            password,
        });
        client.setMaxListeners(Infinity);

        client.on('connect', packet => {
            this.console.log('MQTT client connected, publishing current state.');

            for (const iface of this.device.interfaces) {
                for (const prop of ScryptedInterfaceDescriptors[iface]?.properties || []) {
                    let str = this[prop];
                    if (typeof str === 'object')
                        str = JSON.stringify(str);

                    client.publish(`${this.pathname}/${this.id}/${prop}`, str?.toString() || '');
                }
            }
        })
        client.on('disconnect', () => this.console.log('mqtt client disconnected'));
        client.on('error', e => {
            this.console.log('mqtt client error', e);
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

class MqttProvider extends ScryptedDeviceBase implements DeviceProvider, Settings, MixinProvider {
    devices = new Map<string, any>();
    netServer: net.Server;
    httpServer: http.Server;

    constructor(nativeId?: string) {
        super(nativeId);

        this.maybeEnableBroker();

        for (const deviceId of deviceManager.getNativeIds()) {
            if (deviceId)
                this.getDevice(deviceId);
        }
    }

    async getSettings(): Promise<Setting[]> {
        return [
            {
                key: 'new-device',
                title: 'Add MQTT Custom Handler',
                placeholder: 'Device name, e.g.: Kitchen Light, Office Light, etc',
            },
            {
                key: 'new-autodiscovery',
                title: 'Add MQTT Autodiscovery',
                placeholder: 'Autodiscovery name, e.g.: Zwavejs2Mqtt, Zibgee2Mqtt, etc',
            },
            {
                title: 'Enable MQTT Broker',
                key: 'enableBroker',
                description: 'Enable the Aedes MQTT Broker.',
                group: 'MQTT Broker',
                type: 'boolean',
                value: (this.storage.getItem('enableBroker') === 'true').toString(),
            },
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
            },
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
        ]
    }

    maybeEnableBroker() {
        this.httpServer?.close();
        this.netServer?.close();

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

    async putSetting(key: string, value: string | number) {
        this.storage.setItem(key, value.toString());

        if (brokerProperties.includes(key)) {
            this.maybeEnableBroker();
            return;
        }

        if (key === 'new-device') {

            // generate a random id
            var nativeId = Math.random().toString();
            var name = value.toString();

            deviceManager.onDeviceDiscovered({
                nativeId,
                name: name,
                interfaces: [ScryptedInterface.Scriptable, ScryptedInterface.Settings],
                type: ScryptedDeviceType.Unknown,
            });

            var text = `New MQTT Device ${name} ready. Check the notification area to continue configuration.`;
            log.a(text);
            log.clearAlert(text);
            return;
        }

        if (key === 'new-autodiscovery') {

            // generate a random id
            var nativeId = 'autodiscovery:' + Math.random().toString();
            var name = value.toString();

            deviceManager.onDeviceDiscovered({
                nativeId,
                name: name,
                interfaces: [ScryptedInterface.DeviceProvider, ScryptedInterface.Settings],
                type: ScryptedDeviceType.DeviceProvider,
            });

            var text = `New MQTT Autodiscovery ${name} ready. Check the notification area to continue configuration.`;
            log.a(text);
            log.clearAlert(text);
            return;
        }
    }

    async discoverDevices(duration: number) {
    }

    createMqttDevice(nativeId: string): MqttDevice {
        return;
    }

    getDevice(nativeId: string) {
        let ret = this.devices.get(nativeId);
        if (!ret) {
            if (nativeId.startsWith('autodiscovery:')) {
                ret = new MqttAutoDiscoveryProvider(nativeId);
            }
            else if (nativeId.startsWith('0.')) {
                ret = new MqttDevice(nativeId);
            }
            if (ret)
                this.devices.set(nativeId, ret);
        }
        return ret;
    }


    async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
        return isPublishable(type, interfaces) ? [ScryptedInterface.Settings] : undefined;
    }

    async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any; }): Promise<any> {
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

export default new MqttProvider();
