import { MixinDeviceBase, ScryptedDeviceBase, ScryptedDeviceType } from '@scrypted/sdk';
import { randomBytes } from 'crypto';
import { Categories, HAPStorage } from './hap';
import './types';
import os from 'os';
import { StorageSettingsDict } from '@scrypted/common/src/settings';
import crypto from 'crypto';

class HAPLocalStorage {
    initSync() {

    }
    getItem(key: string): any {
        const data = localStorage.getItem(key);
        if (!data)
            return;
        return JSON.parse(data);
    }
    setItemSync(key: string, value: any) {
        localStorage.setItem(key, JSON.stringify(value));
    }
    removeItemSync(key: string) {
        localStorage.removeItem(key);
    }

    persistSync() {

    }
}

// HAP storage seems to be global?
export function initializeHapStorage() {
    HAPStorage.setStorage(new HAPLocalStorage());
}


export function createHAPUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

export function getHAPUUID(storage: Storage) {
    let uuid = storage.getItem('uuid');
    if (!uuid) {
        uuid = createHAPUUID();
        storage.setItem('uuid', uuid);
    }
    return uuid;
}

export function typeToCategory(type: ScryptedDeviceType): Categories {
    switch (type) {
        case ScryptedDeviceType.Camera:
            return Categories.CAMERA;
        case ScryptedDeviceType.Doorbell:
            return Categories.VIDEO_DOORBELL;
        case ScryptedDeviceType.Fan:
            return Categories.FAN;
        case ScryptedDeviceType.Garage:
            return Categories.GARAGE_DOOR_OPENER;
        case ScryptedDeviceType.Irrigation:
            return Categories.SPRINKLER;
        case ScryptedDeviceType.Light:
            return Categories.LIGHTBULB;
        case ScryptedDeviceType.Lock:
            return Categories.DOOR_LOCK;
        case ScryptedDeviceType.Display:
            return Categories.TELEVISION;
        case ScryptedDeviceType.Outlet:
            return Categories.OUTLET;
        case ScryptedDeviceType.Sensor:
            return Categories.SENSOR;
        case ScryptedDeviceType.Switch:
            return Categories.SWITCH;
        case ScryptedDeviceType.Thermostat:
            return Categories.THERMOSTAT;
        case ScryptedDeviceType.Vacuum:
            return Categories.OUTLET;
    }
}

export function createHAPUsername() {
    const buffers = [];
    for (let i = 0; i < 6; i++) {
        buffers.push(randomBytes(1).toString('hex'));
    }
    return buffers.join(':');
}

export function getAddresses() {
    const addresses = Object.entries(os.networkInterfaces()).filter(([iface]) => iface.startsWith('en') || iface.startsWith('eth') || iface.startsWith('wlan')).map(([_, addr]) => addr).flat().map(info => info.address).filter(address => address);
    return addresses;
}

export function getRandomPort() {
    return Math.round(30000 + Math.random() * 20000);
}

export function createHAPUsernameStorageSettingsDict(): StorageSettingsDict<'mac'> {
    return {
        mac: {
            hide: true,
            group: 'Pairing',
            title: "Username Override",
            persistedDefaultValue: createHAPUsername(),
        },
    }
}
