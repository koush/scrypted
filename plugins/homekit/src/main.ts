import qrcode from '@koush/qrcode-terminal';
import { SettingsMixinDeviceOptions } from '@scrypted/common/src/settings-mixin';
import { sleep } from '@scrypted/common/src/sleep';
import sdk, { MixinProvider, Online, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedInterfaceProperty, Setting, Settings } from '@scrypted/sdk';
import { randomBytes } from 'crypto';
import os from 'os';
import packageJson from "../package.json";
import { maybeAddBatteryService } from './battery';
import { CameraMixin } from './camera-mixin';
import { HomeKitSession, SnapshotThrottle, supportedTypes } from './common';
import { Accessory, Bridge, Categories, Characteristic, ControllerStorage, EventedHTTPServer, MDNSAdvertiser, PublishInfo, Service } from './hap';
import { getHAPUUID, initializeHapStorage, typeToCategory } from './hap-utils';
import { HomekitMixin } from './homekit-mixin';
import { randomPinCode } from './pincode';
import './types';

const { systemManager, deviceManager } = sdk;

initializeHapStorage();
const includeToken = 4;


function getAddresses() {
    const addresses = Object.entries(os.networkInterfaces()).filter(([iface]) => iface.startsWith('en') || iface.startsWith('eth') || iface.startsWith('wlan')).map(([_, addr]) => addr).flat().map(info => info.address).filter(address => address);
    return addresses;
}

class HomeKit extends ScryptedDeviceBase implements MixinProvider, Settings, HomeKitSession {
    bridge = new Bridge('Scrypted', getHAPUUID(this.storage));
    snapshotThrottles = new Map<string, SnapshotThrottle>();
    pincode = randomPinCode();
    homekitConnections = new Set<string>();
    standalones = new Map<string, Accessory>();

    constructor() {
        super();
        this.start();

        if (this.storage.getItem('blankSnapshots') === 'true') {
            this.storage.removeItem('blankSnapshots');
            this.log.a(`The "Never Wait for Snapshots" setting has been moved to the Snapshot Plugin. Install the plugin and enable it on your preferred cameras. origin:/#/component/plugin/install/@scrypted/snapshot`);
        }
    }

    getUsername(storage: Storage) {
        let username = storage.getItem("mac");
        // the HAP sample uses the mac address, but this is problematic if running
        // side by side with homebridge, multi instance, etc.
        if (!username) {
            const buffers = [];
            for (let i = 0; i < 6; i++) {
                buffers.push(randomBytes(1).toString('hex'));
            }
            username = buffers.join(':');
            storage.setItem('mac', username);
        }
        return username;
    }

    async getSettings(): Promise<Setting[]> {
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
                value: this.getUsername(this.storage),
                key: "mac",
            },
            {
                group: 'Network',
                title: 'Scrypted Server Address',
                value: this.storage.getItem('addressOverride'),
                key: 'addressOverride',
                description: 'Optional: The IP address used by the Scrypted server. Set this to the wired IP address to prevent usage of a wireless address.',
                choices: getAddresses(),
                placeholder: '192.168.2.100',
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
                description: 'Optional: The addresses of your HomeKit Hubs. When HomeKit streams to outside of your local network, it is routed through a HomeKit hub. Scrypted can use a lower bitrate stream to keep your remote viewing session responsive.',
                key: 'homekitHubs',
                choices: [...this.homekitConnections],
                value: this.getHomeKitHubs(),
                multiple: true,
                combobox: true,
            },
            {
                key: 'forceOpus',
                group: 'Performance',
                title: 'Force Opus Audio Codec',
                description: 'Adding or resetting a camera accessory will force HomeKit to use the Opus Audio codec rather than AAC-ELD.',
                type: 'boolean',
                value: this.storage.getItem('forceOpus') !== 'false',
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
            const device = systemManager.getDeviceById<Online>(id);
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

                const mixinStorage = deviceManager.getMixinStorage(device.id, this.nativeId);
                const standalone = mixinStorage.getItem('standalone') === 'true';
                const standaloneCategory = typeToCategory(device.type);
                if (standalone && standaloneCategory) {
                    this.standalones.set(device.id, accessory);

                    let published = false;
                    const publish = () => {
                        published = true;
                        accessory.publish({
                            username: this.getUsername(mixinStorage),
                            port: 0,
                            pincode: this.pincode,
                            category: standaloneCategory,
                            addIdentifyingMaterial: false,
                            advertiser: this.getAdvertiser(),
                        });
                    }

                    const mixinConsole = deviceManager.getMixinConsole(device.id, this.nativeId);
                    const maybeUnpublish = async () => {
                        // wait a bit for things to settle before unpublishing
                        sleep(5000);
                        // maybe it was already unpublished due to a weird race condition.
                        if (!published)
                            return;
                        // the online state may no longer be applicable (rebroadcast removed)
                        if (!device.interfaces.includes(ScryptedInterface.Online))
                            return;

                        mixinConsole.warn('Device is in accessory mode has gone offline. HomeKit services are being unpublished. ')
                        published = false;
                        // hack to allow republishing.
                        accessory.controllerStorage = new ControllerStorage(accessory);
                        accessory.unpublish();
                    }

                    if (device.interfaces.includes(ScryptedInterface.Online)) {
                        if (device.online) {
                            publish();
                        }
                        else {
                            mixinConsole.warn('Device is in accessory mode and was offline during HomeKit startup. Device will not be started until it comes back online. Disable accessory mode if this is in error.');
                        }
                        device.listen(ScryptedInterface.Online, () => {
                            if (device.online && !published)
                                publish();
                            else if (!device.online)
                                maybeUnpublish();
                        });
                    }
                    else {
                        publish();
                    }
                }
                else {
                    if (standalone)
                        this.console.warn('Could not find standalone category mapping for accessory', device.name, device.type);
                    this.bridge.addBridgedAccessory(accessory);
                }
            }
        }

        this.storage.setItem('defaultIncluded', JSON.stringify(defaultIncluded));

        const username = this.getUsername(this.storage);
        const info = this.bridge.getService(Service.AccessoryInformation)!;
        info.updateCharacteristic(Characteristic.Manufacturer, "scrypted.app");
        info.updateCharacteristic(Characteristic.Model, "scrypted");
        info.updateCharacteristic(Characteristic.SerialNumber, username);
        info.updateCharacteristic(Characteristic.FirmwareRevision, packageJson.version);

        const publishInfo: PublishInfo = {
            username,
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

        qrcode.generate(this.bridge.setupURI(), { small: true }, (code: string) => {
            this.console.log('Pairing QR Code:')
            this.console.log('\n' + code);
        });

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

        return [ScryptedInterface.Settings];
    }

    async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any }) {
        const options: SettingsMixinDeviceOptions<any> = {
            mixinProviderNativeId: this.nativeId,
            mixinDeviceInterfaces,
            group: "HomeKit Settings",
            groupKey: "homekit",
            mixinDevice, mixinDeviceState,
        };
        let ret: CameraMixin | HomekitMixin<any>;

        if ((mixinDeviceState.type === ScryptedDeviceType.Camera || mixinDeviceState.type === ScryptedDeviceType.Doorbell)
            && mixinDeviceInterfaces.includes(ScryptedInterface.VideoCamera)) {
            ret = new CameraMixin(options);
        }
        else {
            ret = new HomekitMixin(options);
        }

        if (ret.storageSettings.values.standalone) {
            setTimeout(() => {
                const accessory = this.standalones.get(mixinDeviceState.id);
                qrcode.generate(accessory.setupURI(), { small: true }, (code: string) => {
                    ret.console.log('Pairing QR Code:')
                    ret.console.log('\n' + code);
                });
            }, 500);
        }

        return ret;
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
