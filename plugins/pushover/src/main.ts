import { MediaObject, Notifier, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting, Settings, SettingValue } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import { AddProvider } from "../../../common/src/provider-plugin";
import { getCredentials, getCredentialsSettings } from "../../../common/src/credentials-settings";

const sounds = [
    'pushover',
    'bike',
    'bugle',
    'cashregister',
    'classical',
    'cosmic    ',
    'falling',
    'gamelan',
    'incoming',
    'intermission',
    'magic',
    'mechanical',
    'pianobar',
    'siren',
    'spacealarm',
    'tugboat',
    'alien',
    'climb',
    'persistent',
    'echo',
    'updown',
    'vibrate',
    'none',
];

const priorities = {
    'No Alert': -2,
    'Quiet': -1,
    'Normal': 0,
    'High': 1,
    'Require Confirmation': 2,
}

const Push = require('pushover-notifications');
const { log, mediaManager } = sdk;

class PushoverClient extends ScryptedDeviceBase implements Notifier, Settings {
    constructor(nativeId: string) {
        super(nativeId);
    }

    async sendNotification(title: string, body: string, media: string | MediaObject, mimeType?: string): Promise<void> {
        const { username, password } = getCredentials(this);
        const push = new Push({
            user: username,
            token: password,
        });

        let data: Buffer;
        if (typeof media === 'string')
            media = await mediaManager.createMediaObjectFromUrl(media as string, mimeType);
        if (media)
            data = await mediaManager.convertMediaObjectToBuffer(media as MediaObject, 'image/*');


        const msg = {
            message: body,
            title,
            sound: this.storage.getItem('sound') || 'none',
            device: this.storage.getItem('device'),
            priority: priorities[this.storage.getItem('priority') || 'Normal'],
            file: data ? { name: 'media.jpg', data } : undefined,
        };

        return new Promise((resolve, reject) => {
            push.send(msg, (err: Error, result: any) => {
                if (err) {
                    this.console.error('pushover error', err);
                    return reject(err);
                }

                this.console.log('pushover success', result);
                resolve();
            })
        })
    }

    async getSettings(): Promise<Setting[]> {
        const settings = getCredentialsSettings(this, {
            userTitle: 'User',
            passwordTitle: 'Token',
        });

        settings.push({
            title: 'Device',
            key: 'device',
            description: 'Send notifications to specific device. Leaving this blank will send to all devices.',
            value: this.storage.getItem('device'),
        });

        settings.push({
            title: 'Sound',
            key: 'sound',
            description: 'Notification Sound',
            choices: sounds,
            value: this.storage.getItem('sound') || 'none',
        });

        settings.push({
            title: 'Priority',
            key: 'priority',
            description: 'Notification Priority',
            choices: Object.keys(priorities),
            value: this.storage.getItem('priority') || 'Normal',
        });

        return settings;
    }

    async putSetting(key: string, value: SettingValue): Promise<void> {
        this.storage.setItem(key, value.toString());
    }
}

export default new AddProvider(undefined, "Pushover Client", ScryptedDeviceType.Notifier, [
    ScryptedInterface.Notifier,
    ScryptedInterface.Settings,
], nativeId => new PushoverClient(nativeId));
