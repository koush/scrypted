import sdk, { Settings, MixinProvider, ScryptedDeviceBase, ScryptedDeviceType, Setting, ScryptedInterface, ScryptedInterfaceProperty } from '@scrypted/sdk';
import { Bridge, Categories, Characteristic, MDNSAdvertiser, PublishInfo, Service } from './hap';
import os from 'os';
import { HomeKitSession, SnapshotThrottle, supportedTypes } from './common';
import './types'
import { CameraMixin } from './camera-mixin';
import { maybeAddBatteryService } from './battery';
import { randomBytes } from 'crypto';
import qrcode from 'qrcode';
import packageJson from "../package.json";
import { randomPinCode } from './pincode';
import { EventedHTTPServer } from 'hap-nodejs/dist/lib/util/eventedhttp';
import { getHAPUUID, initializeHapStorage } from './hap-utils';

const { systemManager, deviceManager } = sdk;

initializeHapStorage();

const includeToken = 4;

class HomeKit extends ScryptedDeviceBase implements MixinProvider, Settings, HomeKitSession {
    bridge = new Bridge('Scrypted', getHAPUUID(this.storage));
    snapshotThrottles = new Map<string, SnapshotThrottle>();
    pincode = randomPinCode();
    homekitConnections = new Set<string>();

    constructor() {
        super();
        this.start();
    }

    getUsername() {
        let username = this.storage.getItem("mac");
        // the HAP sample uses the mac address, but this is problematic if running
        // side by side with homebridge, multi instance, etc.
        if (!username) {
            const buffers = [];
            for (let i = 0; i < 6; i++) {
                buffers.push(randomBytes(1).toString('hex'));
            }
            username = buffers.join(':');
            this.storage.setItem('mac', username);
        }
        return username;
    }

    async getSettings(): Promise<Setting[]> {
        const addresses = Object.entries(os.networkInterfaces()).filter(([iface]) => iface.startsWith('en') || iface.startsWith('eth') || iface.startsWith('wlan')).map(([_, addr]) => addr).flat().map(info => info.address).filter(address => address);
        return [
            {
                group: 'Pairing',
                title: "Manual Pairing Code",
                key: "pairingCode",
                readonly: true,
                value: this.pincode,
            },
            {
                group: 'Pairing',
                title: "Camera QR Code",
                key: "qrCode",
                readonly: true,
                value: "The Pairing QR Code can be viewed in the 'Console'",
            },
            {
                group: 'Pairing',
                title: "Username Override",
                value: this.getUsername(),
                key: "mac",
            },
            {
                group: 'Network',
                title: 'Bridge Address',
                value: this.storage.getItem('addressOverride'),
                key: 'addressOverride',
                description: 'Optional: The network address used by the Scrypted bridge. Set this to the wired address to prevent usage of wireless address.',
                choices: addresses,
                combobox: true,
            },
            {
                group: 'Network',
                title: 'Bridge Port',
                value: this.getHAPPort().toString(),
                key: 'portOverride',
                description: 'Optional: The TCP port used by the Scrypted bridge. If none is specified, a random port will be chosen.',
                type: 'number',
            },
            {
                group: 'Network',
                title: 'mDNS Advertiser',
                description: 'Optional: Override the mDNS advertiser used to locate the Scrypted bridge',
                key: 'advertiserOverride',
                choices: [MDNSAdvertiser.BONJOUR, MDNSAdvertiser.CIAO],
                value: this.getAdvertiser(),
            },
            {
                group: 'Performance',
                title: 'HomeKit Hubs',
                description: 'Optional: The addresses of your HomeKit Hubs used to serve lower resolution live streams for remote viewing.',
                key: 'homekitHubs',
                choices: [...this.homekitConnections],
                value: this.getHomeKitHubs(),
                multiple: true,
                combobox: true,
            },
            {
                group: 'Performance',
                title: 'Never Wait for Snapshots',
                value: (localStorage.getItem('blankSnapshots') === 'true').toString(),
                key: 'blankSnapshots',
                description: 'Send blank images instead of waiting snapshots. Improves up HomeKit responsiveness when bridging a large number of cameras.',
                type: 'boolean'
            }
        ]
    }

    async putSetting(key: string, value: string | number | boolean): Promise<void> {
        if (key === 'homekitHubs') {
            this.storage.setItem(key, JSON.stringify(value));
        }
        else {
            this.storage.setItem(key, value.toString());
        }

        if (key === 'portOverride' || key === 'advertiserOverride') {
            this.log.a('Reload the HomeKit plugin to apply this change.');
        }
    }

    async start() {
        this.log.clearAlerts();

        let defaultIncluded: any;
        try {
            defaultIncluded = JSON.parse(this.storage.getItem('defaultIncluded'));
        }
        catch (e) {
            defaultIncluded = {};
        }

        const plugins = await systemManager.getComponent('plugins');

        const accessoryIds = new Set<string>();

        for (const id of Object.keys(systemManager.getSystemState())) {
            const device = systemManager.getDeviceById(id);
            const supportedType = supportedTypes[device.type];
            if (!supportedType?.probe(device))
                continue;

            try {
                const mixins = (device.mixins || []).slice();
                if (!mixins.includes(this.id)) {
                    if (defaultIncluded[device.id] === includeToken)
                        continue;
                    mixins.push(this.id);
                    await plugins.setMixins(device.id, mixins);
                    defaultIncluded[device.id] = includeToken;
                }
            }
            catch (e) {
                console.error('error while checking device if syncable', e);
                this.log.a('Error while checking device if syncable. See Console.');
                continue;
            }

            this.console.log('adding', device.name);

            const accessory = await supportedType.getAccessory(device, this);
            if (accessory) {
                accessoryIds.add(id);

                maybeAddBatteryService(device, accessory);

                const deviceInfo = device.info;
                if (deviceInfo) {
                    const info = accessory.getService(Service.AccessoryInformation)!;
                    if (deviceInfo.manufacturer)
                        info.updateCharacteristic(Characteristic.Manufacturer, deviceInfo.manufacturer);
                    if (deviceInfo.model)
                        info.updateCharacteristic(Characteristic.Model, deviceInfo.model);
                    if (deviceInfo.serialNumber)
                        info.updateCharacteristic(Characteristic.SerialNumber, deviceInfo.serialNumber);
                    if (deviceInfo.firmware)
                        info.updateCharacteristic(Characteristic.FirmwareRevision, deviceInfo.firmware);
                    if (deviceInfo.version)
                        info.updateCharacteristic(Characteristic.HardwareRevision, deviceInfo.version);
                }

                if (supportedType.noBridge) {
                    accessory.publish({
                        username: '12:34:45:54:24:44',
                        pincode: this.pincode,
                        port: 0,
                        category: Categories.TELEVISION,
                    })
                }
                else {
                    this.bridge.addBridgedAccessory(accessory);
                }
            }
        }

        this.storage.setItem('defaultIncluded', JSON.stringify(defaultIncluded));

        const username = this.getUsername();

        const info = this.bridge.getService(Service.AccessoryInformation)!;
        info.updateCharacteristic(Characteristic.Manufacturer, "scrypted.app");
        info.updateCharacteristic(Characteristic.Model, "scrypted");
        info.updateCharacteristic(Characteristic.SerialNumber, username);
        info.updateCharacteristic(Characteristic.FirmwareRevision, packageJson.version);

        const publishInfo: PublishInfo = {
            username: username,
            port: this.getHAPPort(),
            pincode: this.pincode,
            category: Categories.BRIDGE,
            addIdentifyingMaterial: true,
            advertiser: this.getAdvertiser(),
        };

        this.bridge.publish(publishInfo, true);
        const server: EventedHTTPServer = (this.bridge as any)._server.httpServer;
        server.on('connection-opened', connection => {
            connection.on('authenticated', () => {
                this.console.log('HomeKit Connection', connection.remoteAddress);
                this.homekitConnections.add(connection.remoteAddress);
            })
            connection.on('closed', () => this.homekitConnections.delete(connection.remoteAddress));
        });


        qrcode.toString(this.bridge.setupURI(), {
            type: 'terminal',
        }, (e, code) => {
            this.console.log('Pairing QR Code:')
            this.console.log(code);
        })

        systemManager.listen(async (eventSource, eventDetails, eventData) => {
            if (eventDetails.eventInterface !== ScryptedInterface.ScryptedDevice)
                return;

            if (!eventDetails.changed)
                return;

            if (!eventDetails.property)
                return;

            if (eventDetails.property === ScryptedInterfaceProperty.id)
                return;

            const canMixin = await this.canMixin(eventSource.type, eventSource.interfaces);
            const includes = eventSource?.mixins?.includes(this.id);
            const has = accessoryIds.has(eventSource?.id);
            if (has && !canMixin) {
                this.console.log('restart event', eventSource?.id, eventDetails.property, eventData);
                this.log.a(`${eventSource.name} can no longer be synced. Reload the HomeKit plugin to apply these changes.`);
                return;
            }

            if (!has && includes) {
                this.console.log('restart event', eventSource?.id, eventDetails.property, eventData);
                this.log.a(`${eventSource.name} was added. HomeKit plugin will reload momentarily.`);
                deviceManager.requestRestart();
                return;
            }
        });
    }

    getAdvertiser() {
        const advertiser = this.storage.getItem('advertiserOverride');
        switch (advertiser) {
            case MDNSAdvertiser.BONJOUR:
                return MDNSAdvertiser.BONJOUR;
            case MDNSAdvertiser.CIAO:
                return MDNSAdvertiser.CIAO;
        }

        // return os.platform() === 'win32' ? MDNSAdvertiser.CIAO : MDNSAdvertiser.BONJOUR;
        return MDNSAdvertiser.CIAO;
    }

    getHAPPort() {
        let port = parseInt(this.storage.getItem('portOverride')) || 0;
        if (!port) {
            port = Math.round(10000 + Math.random() * 30000);
            this.storage.setItem('portOverride', port.toString());
        }
        return port;
    }

    getHomeKitHubs(): string[] {
        try {
            return JSON.parse(this.storage.getItem('homekitHubs'));
        }
        catch (e) {
        }
    }

    getAutoHomeKitHubs(): string[] {
        try {
            return JSON.parse(this.storage.getItem('autoHomekitHubs'));
        }
        catch (e) {
            return [];
        }
    }

    isHomeKitHub(address: string) {
        return !!this.getHomeKitHubs()?.find(check => check.endsWith(address));
    }

    detectedHomeKitHub(ip: string) {
        try {
            const homekitHubs = this.getHomeKitHubs();
            if (homekitHubs?.includes(ip))
                return;
            const autoHomekitHubs = this.getAutoHomeKitHubs();
            if (autoHomekitHubs.includes(ip))
                return;
            autoHomekitHubs.push(ip);
            homekitHubs.push(ip);
            this.storage.setItem('autoHomekitHubs', JSON.stringify(autoHomekitHubs));
            this.storage.setItem('homekitHubs', JSON.stringify(homekitHubs));
        }
        catch (e) {
        }
    }

    async canMixin(type: ScryptedDeviceType, interfaces: string[]) {
        const supportedType = supportedTypes[type];
        if (!supportedType?.probe({
            interfaces,
            type,
        })) {
            return null;
        }

        if ((type === ScryptedDeviceType.Camera || type === ScryptedDeviceType.Doorbell)
            && interfaces.includes(ScryptedInterface.VideoCamera)) {
            return [ScryptedInterface.Settings];
        }
        return [];
    }
    getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any }) {
        if ((mixinDeviceState.type === ScryptedDeviceType.Camera || mixinDeviceState.type === ScryptedDeviceType.Doorbell)
            && mixinDeviceInterfaces.includes(ScryptedInterface.VideoCamera)) {
            return new CameraMixin(mixinDevice, mixinDeviceInterfaces, mixinDeviceState, this.nativeId);
        }
        return mixinDevice;
    }

    async releaseMixin(id: string, mixinDevice: any) {
        const device = systemManager.getDeviceById(id);
        if (device.mixins?.includes(this.id)) {
            return;
        }
        this.console.log('release mixin', id);
        this.log.a(`${device.name} was removed. The HomeKit plugin will reload momentarily.`);
        deviceManager.requestRestart();
    }
}

export default new HomeKit();
