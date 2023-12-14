import { Settings, Setting, ScryptedDeviceBase, ScryptedInterface } from '@scrypted/sdk';
import { connect, Client } from 'mqtt';
import { ScriptableDeviceBase } from '../scrypted-eval';
import type {MqttProvider} from '../main';

export class MqttDeviceBase extends ScriptableDeviceBase implements Settings {
    client: Client;
    handler: any;
    pathname: string;

    constructor(public provider: MqttProvider, nativeId: string) {
        super(nativeId, undefined);
    }

    async getSettings(): Promise<Setting[]> {
        return [
            {
                title: 'Subscription URL',
                key: 'url',
                value: this.storage.getItem('url'),
                description: "The base subscription URL for the device. All MQTT publish and subscribe requests will use this as the base path.",
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

    async putSetting(key: string, value: string | number | boolean) {
        if (key === 'url') {
            let url = value.toString();
            if (!url.endsWith('/'))
                url += '/';
            this.storage.setItem(key, url);
        }
        else {
            this.storage.setItem(key, value.toString());
        }
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);
    }

    connectClient() {
        this.client?.removeAllListeners();
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
            username: this.storage.getItem('username') || undefined,
            password: this.storage.getItem('password') || undefined,
        });
        client.setMaxListeners(Infinity);

        client.on('connect', packet => {
            this.console.log('connected to mqtt', packet);
        })
        
        return this.client;
    }
}
