import { ScryptedDeviceBase, Setting } from "@scrypted/sdk";

export interface CredentailSettingsOptions {
    userTitle?: string;
    usernameDescription?: string;
    passwordTitle?: string;
    passwordDescription?: string;
    group?: string;
}

export function getCredentialsSettings(device: ScryptedDeviceBase, options?: CredentailSettingsOptions): Setting[] {
    return [
        {
            group: options?.group,
            key: 'username',
            title: options?.userTitle ||'Username',
            description: options?.usernameDescription,
            value: device.storage.getItem('username'),
        },
        {
            group: options?.group,
            key: 'password',
            type: 'password',
            title: options?.passwordTitle || 'Password',
            description: options?.passwordDescription,
            value: device.storage.getItem('password'),
        },
    ]
}

export function getCredentials(device: ScryptedDeviceBase): {username: string, password: string} {
    return {
        username: device.storage.getItem('username'),
        password: device.storage.getItem('password'),
    }
}
