import { Settings, Setting, ScryptedDeviceBase, ScryptedInterface } from '@scrypted/sdk';
import { connect, Client } from 'mqtt';
import { ScriptableDeviceBase } from '../scrypted-eval';

export class MqttDeviceBase extends ScriptableDeviceBase implements Settings {
    client: Client;
    handler: any;
    pathname: string;

    constructor(nativeId: string) {
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
        const url = new URL(this.storage.getItem('url'));
        this.pathname = url.pathname.substring(1);
        const urlWithoutPath = new URL(this.storage.getItem('url'));
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
