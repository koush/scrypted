import { Settings, Setting, ScryptedDeviceBase } from '@scrypted/sdk';
import { connect, Client } from 'mqtt';

export class MqttDeviceBase extends ScryptedDeviceBase implements Settings {
    client: Client;
    handler: any;
    pathname: string;

    constructor(nativeId: string) {
        super(nativeId);
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
    }

    connectClient() {
        this.client?.end();
        this.client = undefined;
        const url = new URL(this.storage.getItem('url'));
        this.pathname = url.pathname.substring(1);
        const urlWithoutPath = new URL(this.storage.getItem('url'));
        urlWithoutPath.pathname = '';

        const client = this.client = connect(urlWithoutPath.toString(), {
            username: this.storage.getItem('username') || undefined,
            password: this.storage.getItem('password') || undefined,
        });
        client.setMaxListeners(Infinity);

        setTimeout(() => {
            client.on('connect', err => {
                if (err) {
                    this.console.error('error subscribing to mqtt', err);
                    return;
                }
            })
        }, 500);

        return this.client;
    }
}