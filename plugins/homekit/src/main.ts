import qrcode from '@koush/qrcode-terminal';
import { StorageSettings } from '@scrypted/common/src/settings';
import { SettingsMixinDeviceOptions } from '@scrypted/common/src/settings-mixin';
import { sleep } from '@scrypted/common/src/sleep';
import sdk, { DeviceProvider, MixinProvider, Online, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedInterfaceProperty, Setting, Settings } from '@scrypted/sdk';
import packageJson from "../package.json";
import { maybeAddBatteryService } from './battery';
import { CameraMixin, canCameraMixin } from './camera-mixin';
import { SnapshotThrottle, supportedTypes } from './common';
import { Accessory, Bridge, Categories, Characteristic, ControllerStorage, EventedHTTPServer, MDNSAdvertiser, PublishInfo, Service } from './hap';
import { createHAPUsernameStorageSettingsDict, getAddresses, getHAPUUID, getRandomPort as createRandomPort, initializeHapStorage, logConnections, typeToCategory } from './hap-utils';
import { HomekitMixin, HOMEKIT_MIXIN } from './homekit-mixin';
import { randomPinCode } from './pincode';
import './types';
import { VIDEO_CLIPS_NATIVE_ID } from './types/camera/camera-recording-files';
import { VideoClipsMixinProvider } from './video-clips-provider';
import crypto from 'crypto';

const { systemManager, deviceManager } = sdk;

initializeHapStorage();
const includeToken = 4;

export class HomeKitPlugin extends ScryptedDeviceBase implements MixinProvider, Settings, DeviceProvider {
    bridge = new Bridge('Scrypted', getHAPUUID(this.storage));
    snapshotThrottles = new Map<string, SnapshotThrottle>();
    standalones = new Map<string, Accessory>();
    videoClips: VideoClipsMixinProvider;
    videoClipsId: string;
    cameraMixins = new Map<string, CameraMixin>();
    storageSettings = new StorageSettings(this, {
        pincode: {
            group: 'Pairing',
            title: "Manual Pairing Code",
            persistedDefaultValue: randomPinCode(),
        },
        qrCode: {
            group: 'Pairing',
            title: "QR Code",
            readonly: true,
            defaultValue: "The Pairing QR Code can be viewed in the 'Console'",
        },
        resetAccessory: {
            title: 'Reset Pairing',
            description: 'This will reset the Scrypted HomeKit Bridge and all bridged devices. The previous Scrypted HomeKit Bridge must be removed from the Home app, and Scrypted must be paired with HomeKit again.',
            placeholder: 'RESET',
            mapPut: (oldValue, newValue) => {
                if (newValue === 'RESET') {
                    this.storage.removeItem(this.storageSettings.keys.mac);
                    this.log.a(`You must reload the HomeKit plugin for the changes to take effect.`);
                    // generate a new reset accessory random value.
                    return crypto.randomBytes(8).toString('hex');
                }
                throw new Error('HomeKit Accessory Reset cancelled.');
            },
            mapGet: () => '',
        },
        ...createHAPUsernameStorageSettingsDict(),
        addressOverride: {
            group: 'Network',
            title: 'Scrypted Server Address',
            key: 'addressOverride',
            description: 'Optional: The IP address used by the Scrypted server. Set this to the wired IP address to prevent usage of a wireless address.',
            placeholder: '192.168.2.100',
            combobox: true,
            async onGet() {
                return {
                    choices: getAddresses(),
                }
            }
        },
        portOverride: {
            group: 'Network',
            title: 'Bridge Port',
            persistedDefaultValue: createRandomPort(),
            description: 'Optional: The TCP port used by the Scrypted bridge. If none is specified, a random port will be chosen.',
            type: 'number',
        },
        advertiserOverride: {
            group: 'Network',
            title: 'mDNS Advertiser',
            description: 'Optional: Override the mDNS advertiser used to locate the Scrypted bridge',
            choices: [MDNSAdvertiser.BONJOUR, MDNSAdvertiser.CIAO],
            defaultValue: MDNSAdvertiser.CIAO,
        },
        lastKnownHomeHub: {
            hide: true,
            description: 'The last home hub to request a recording. Internally used to determine if a streaming request is coming from remote wifi.',
        }
    });

    constructor() {
        super();
        this.start();

        (async () => {
            await deviceManager.onDevicesChanged({
                devices: [
                    {
                        name: 'Save HomeKit Video Clips',
                        nativeId: VIDEO_CLIPS_NATIVE_ID,
                        type: ScryptedDeviceType.DataSource,
                        interfaces: [
                            ScryptedInterface.VideoClips,
                            ScryptedInterface.MixinProvider,
                            ScryptedInterface.Settings,
                            ScryptedInterface.Readme,
                        ],
                    }
                ]
            });
            this.videoClips = new VideoClipsMixinProvider(VIDEO_CLIPS_NATIVE_ID);
            this.videoClipsId = this.videoClips.id;
        })();
    }

    getDevice(nativeId: string) {
        if (nativeId === VIDEO_CLIPS_NATIVE_ID)
            return this.videoClips;
        throw new Error('unknown device: ' + nativeId);
    }

    async getSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }

    async putSetting(key: string, value: string | number | boolean): Promise<void> {
        await this.storageSettings.putSetting(key, value);

        if (key === this.storageSettings.keys.portOverride || key === this.storageSettings.keys.addressOverride) {
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

                    const storageSettings = new StorageSettings({
                        storage: mixinStorage,
                        onDeviceEvent: async () => {
                        }
                    }, createHAPUsernameStorageSettingsDict())

                    const mixinConsole = deviceManager.getMixinConsole(device.id, this.nativeId);

                    let published = false;
                    let hasPublished = false;
                    const publish = () => {
                        published = true;
                        mixinConsole.log('Device is in accessory mode and is online. HomeKit services are being published.');
                        accessory.publish({
                            username: storageSettings.values.mac,
                            port: 0,
                            pincode: this.storageSettings.values.pincode,
                            category: standaloneCategory,
                            addIdentifyingMaterial: false,
                            advertiser: this.storageSettings.values.advertiserOverride,
                        });
                        if (!hasPublished) {
                            hasPublished = true;
                            logConnections(mixinConsole, accessory);
                        }
                    }

                    const unpublish = () => {
                        mixinConsole.warn('Device is in accessory mode and is offline. HomeKit services are being unpublished. ')
                        published = false;
                        // hack to allow republishing.
                        accessory.controllerStorage = new ControllerStorage(accessory);
                        accessory.unpublish();
                    }

                    const updateDeviceAdvertisement = () => {
                        const isOnline = !device.interfaces.includes(ScryptedInterface.Online) || device.online;
                        if (isOnline && !published) {
                            publish();
                        }
                        else if (!isOnline && published) {
                            unpublish();
                        }
                    }

                    updateDeviceAdvertisement();
                    if (!published)
                        mixinConsole.warn('Device is in accessory mode and was offline during HomeKit startup. Device will not be started until it comes back online. Disable accessory mode if this is in error.');

                    // throttle this in case the device comes back online very quickly.
                    device.listen(ScryptedInterface.Online, () => {
                        const isOnline = !device.interfaces.includes(ScryptedInterface.Online) || device.online;
                        if (isOnline)
                            updateDeviceAdvertisement();
                        else
                            setTimeout(updateDeviceAdvertisement, 30000);
                    });
                }
                else {
                    if (standalone)
                        this.console.warn('Could not find standalone category mapping for accessory', device.name, device.type);
                    this.bridge.addBridgedAccessory(accessory);
                }
            }
        }

        this.storage.setItem('defaultIncluded', JSON.stringify(defaultIncluded));

        const username = this.storageSettings.values.mac
        const info = this.bridge.getService(Service.AccessoryInformation)!;
        info.updateCharacteristic(Characteristic.Manufacturer, "scrypted.app");
        info.updateCharacteristic(Characteristic.Model, "scrypted");
        info.updateCharacteristic(Characteristic.SerialNumber, username);
        info.updateCharacteristic(Characteristic.FirmwareRevision, packageJson.version);

        const publishInfo: PublishInfo = {
            username,
            port: this.storageSettings.values.portOverride,
            pincode: this.storageSettings.values.pincode,
            category: Categories.BRIDGE,
            addIdentifyingMaterial: true,
            advertiser: this.storageSettings.values.advertiserOverride,
        };

        this.bridge.publish(publishInfo, true);
        logConnections(this.console, this.bridge);

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

    async canMixin(type: ScryptedDeviceType, interfaces: string[]) {
        const supportedType = supportedTypes[type];
        if (!supportedType?.probe({
            interfaces,
            type,
        })) {
            return null;
        }

        const ret = [
            ScryptedInterface.Settings,
            HOMEKIT_MIXIN,
        ];

        return ret;
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

        if (canCameraMixin(mixinDeviceState.type, mixinDeviceInterfaces)) {
            ret = new CameraMixin(options);
            this.cameraMixins.set(ret.id, ret);
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

export default new HomeKitPlugin();
