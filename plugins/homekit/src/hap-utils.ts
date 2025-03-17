import { closeQuiet, createBindZero } from '@scrypted/common/src/listen-cluster';
import sdk, { ScryptedDeviceType } from '@scrypted/sdk';
import { StorageSettingsDict } from "@scrypted/sdk/storage-settings";
import crypto, { randomBytes } from 'crypto';
import { once } from 'events';
import os from 'os';
import { Categories, EventedHTTPServer, HAPStorage } from './hap';
import { randomPinCode } from './pincode';
import './types';

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

export function typeToCategory(type: ScryptedDeviceType | string): Categories {
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
        case ScryptedDeviceType.Siren:
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
    const addresses = Object.entries(os.networkInterfaces()).filter(([iface]) => iface.startsWith('en') || iface.startsWith('eth') || iface.startsWith('wlan') || iface.startsWith('net')).map(([_, addr]) => addr).flat().map(info => info.address).filter(address => address);
    return addresses;
}

export function getRandomPort() {
    return Math.round(30000 + Math.random() * 20000);
}

export function createHAPUsernameStorageSettingsDict(device: { storage: Storage, name?: string }, group: string, subgroup?: string): StorageSettingsDict<'mac' | 'addIdentifyingMaterial' | 'qrCode' | 'pincode' | 'portOverride' | 'resetAccessory'> {
    const alertReload = () => {
        sdk.log.a(`The HomeKit plugin will reload momentarily for the changes to ${device.name} to take effect.`);
        sdk.deviceManager.requestRestart();
    }

    return {
        addIdentifyingMaterial: {
            hide: true,
            type: 'boolean',
        },
        qrCode: {
            group,
            // subgroup,
            title: "Pairing QR Code",
            type: 'html',
            readonly: true,
            description: "Scan with your iOS camera to pair this Scrypted with HomeKit.",
        },
        portOverride: {
            group,
            subgroup,
            title: 'Bridge Port',
            persistedDefaultValue: getRandomPort(),
            description: 'Optional: The TCP port used by the Scrypted bridge. If none is specified, a random port will be chosen.',
            type: 'number',
        },
        pincode: {
            group,
            // subgroup,
            title: "Manual Pairing Code",
            persistedDefaultValue: randomPinCode(),
            readonly: true,
        },
        mac: {
            group,
            subgroup,
            hide: true,
            title: "Username Override",
            persistedDefaultValue: createHAPUsername(),
        },
        resetAccessory: {
            group,
            subgroup,
            title: 'Reset Pairing',
            description: 'Resetting the pairing will resync it to HomeKit as a new device. Bridged devices will automatically relink as a new device. Accessory devices must be manually removed from the Home app and re-paired. Enter RESET to reset the pairing.',
            placeholder: 'RESET',
            mapPut: (oldValue, newValue) => {
                if (newValue === 'RESET') {
                    device.storage.removeItem('mac');
                    alertReload();
                    // generate a new reset accessory random value.
                    return crypto.randomBytes(8).toString('hex');
                }
                throw new Error('HomeKit Accessory Reset cancelled.');
            },
            mapGet: () => '',
        },
    }
}

export function logConnections(console: Console, accessory: any, seenConnections: Set<string>) {
    const server: EventedHTTPServer = accessory._server.httpServer;
    server.on('connection-opened', connection => {
        connection.on('authenticated', () => {
            console.log('HomeKit Connection', connection.remoteAddress);
            seenConnections.add(connection.remoteAddress);
        });
    });
}

export async function pickPort() {
    const { port, server: tempSocket } = await createBindZero();
    const closePromise = once(tempSocket, 'close');
    closeQuiet(tempSocket);
    await closePromise;
    return port;
}
