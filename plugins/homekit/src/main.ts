import { SettingsMixinDeviceOptions } from '@scrypted/common/src/settings-mixin';
import sdk, { DeviceProvider, MixinProvider, Online, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedInterfaceProperty, Setting, Settings, WritableDeviceState } from '@scrypted/sdk';
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import fs from 'fs';
import packageJson from "../package.json";
import { getScryptedServerAddresses } from "./address-override";
import { maybeAddBatteryService } from './battery';
import { CameraMixin, canCameraMixin } from './camera-mixin';
import { SnapshotThrottle, supportedTypes } from './common';
import { Accessory, Bridge, Categories, Characteristic, ControllerStorage, HAPStorage, MDNSAdvertiser, PublishInfo, Service } from './hap';
import { createHAPUsernameStorageSettingsDict, getRandomPort as createRandomPort, getHAPUUID, logConnections, typeToCategory } from './hap-utils';
import { HOMEKIT_MIXIN, HomekitMixin } from './homekit-mixin';
import { addAccessoryDeviceInfo } from './info';
import { randomPinCode } from './pincode';
import './types';
import { VIDEO_CLIPS_NATIVE_ID } from './types/camera/camera-recording-files';
import { reorderDevicesByProvider } from './util';
import { VideoClipsMixinProvider } from './video-clips-provider';
import QRCode from 'qrcode-svg';

const hapStorage: Storage = {
    get length() {
        return localStorage.length;
    },
    clear: function (): void {
        return localStorage.clear();
    },
    key: function (index: number): string {
        return localStorage.key(index);
    },
    removeItem: function (key: string): void {
        return localStorage.removeItem(key);
    },
    getItem(key: string): any {
        const data = localStorage.getItem(key);
        if (!data)
            return;
        return JSON.parse(data);
    },
    setItem(key: string, value: any) {
        localStorage.setItem(key, JSON.stringify(value));
    },
    setItemSync(key: string, value: any) {
        localStorage.setItem(key, JSON.stringify(value));
    },
    removeItemSync(key: string) {
        localStorage.removeItem(key);
    },
    persistSync() {
    }
}
HAPStorage.storage = () => {
    return hapStorage;
}

const { systemManager, deviceManager } = sdk;

const includeToken = 4;

export class HomeKitPlugin extends ScryptedDeviceBase implements MixinProvider, Settings, DeviceProvider {
    seenConnections = new Set<string>();
    bridge = new Bridge('Scrypted', getHAPUUID(this.storage));
    snapshotThrottles = new Map<string, SnapshotThrottle>();
    standalones = new Map<string, Accessory>();
    videoClips: VideoClipsMixinProvider;
    videoClipsId: string;
    cameraMixins = new Map<string, CameraMixin>();
    storageSettings = new StorageSettings(this, {
        ...createHAPUsernameStorageSettingsDict(this, undefined),
        portOverride: {
            group: 'Network',
            title: 'Server Port',
            persistedDefaultValue: createRandomPort(),
            description: 'Optional: The TCP port used by the Scrypted Server. If none is specified, a random port will be chosen.',
            type: 'number',
        },
        advertiserOverride: {
            group: 'Network',
            title: 'mDNS Advertiser',
            description: 'Optional: Override the mDNS advertiser used to locate the Scrypted bridge',
            choices: ['Default', MDNSAdvertiser.CIAO, MDNSAdvertiser.BONJOUR, MDNSAdvertiser.AVAHI],
            defaultValue: 'Default',
        },
        advertiserAddresses: {
            group: 'Network',
            title: 'mDNS Interfaces',
            description: 'Optional: Change the address or interfaces that will advertise the HomeKit bridge and accessories.',
            placeholder: '192.168.2.111, en0, etc.',
            combobox: true,
            choices: [
                'Default',
                'Server Address',
                'All Addresses',
            ],
            defaultValue: 'Default',
        },
        slowConnections: {
            group: 'Network',
            title: 'Slow Mode Addresses',
            description: 'The addressess of Home Hubs and iOS clients that will always be served remote/medium streams.',
            type: 'string',
            multiple: true,
            combobox: true,
            onGet: async () => {
                return {
                    choices: [...this.seenConnections],
                }
            }
        },
        lastKnownHomeHub: {
            hide: true,
            description: 'The last home hub to request a recording. Internally used to determine if a streaming request is coming from remote wifi.',
        },
        autoAdd: {
            title: "Auto enable",
            description: "Automatically enable this mixin on new devices.",
            type: 'boolean',
            defaultValue: true,
        },
    });
    mergedDevices = new Set<string>();

    constructor() {
        super();
        this.start();

        (async () => {
            await deviceManager.onDevicesChanged({
                devices: [
                    {
                        name: 'HomeKit Secure Video Debug Mode Clips',
                        nativeId: VIDEO_CLIPS_NATIVE_ID,
                        type: ScryptedDeviceType.DataSource,
                        interfaces: [
                            ScryptedInterface.VideoClips,
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

    async releaseDevice(id: string, nativeId: string): Promise<void> {
    }

    async getDevice(nativeId: string) {
        if (nativeId === VIDEO_CLIPS_NATIVE_ID)
            return this.videoClips;
        throw new Error('unknown device: ' + nativeId);
    }

    async getSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }

    async putSetting(key: string, value: string | number | boolean): Promise<void> {
        await this.storageSettings.putSetting(key, value);

        if (key === this.storageSettings.keys.portOverride) {
            this.log.a(`The HomeKit plugin will reload momentarily for the changes to ${this.name} to take effect.`);
        }
    }

    getAdvertiser() {
        let advertiser: MDNSAdvertiser = this.storageSettings.values.advertiserOverride;
        switch (advertiser) {
            case MDNSAdvertiser.BONJOUR:
            case MDNSAdvertiser.AVAHI:
            case MDNSAdvertiser.CIAO:
                break;
            default:
                advertiser = MDNSAdvertiser.CIAO;
                // this avahi detection doesn't work sometimes? fails silently.
                // if (fs.existsSync('/var/run/avahi-daemon/'))
                //     advertiser = MDNSAdvertiser.AVAHI;
                // else
                //     advertiser = MDNSAdvertiser.CIAO;
                break;
        }
        return advertiser;
    }

    async start() {
        this.log.clearAlerts();
        this.mergedDevices = new Set<string>();

        let defaultIncluded: any;
        try {
            defaultIncluded = JSON.parse(this.storage.getItem('defaultIncluded'));
        }
        catch (e) {
            defaultIncluded = {};
        }

        const accessoryIds = new Set<string>();
        const deviceIds = Object.keys(systemManager.getSystemState());

        // when creating accessories in order, some DeviceProviders may merge in
        // their child devices (and report back which devices are merged via
        // this.mergedDevices)
        // we need to ensure that the iteration processes DeviceProviders before
        // their children, so a reordering is necessary
        const reorderedDeviceIds = reorderDevicesByProvider(deviceIds);

        // safety checks in case something went wrong
        if (deviceIds.length !== reorderedDeviceIds.length) {
            throw Error(`error in device reordering, expected ${deviceIds.length} devices but only got ${reorderedDeviceIds.length}!`);
        }
        const uniqueDeviceIds = new Set<string>(deviceIds);
        const uniqueReorderedIds = new Set<string>(reorderedDeviceIds);
        if (uniqueDeviceIds.size !== uniqueReorderedIds.size) {
            throw Error(`error in device reordering, expected ${uniqueDeviceIds.size} unique devices but only got ${uniqueReorderedIds.size} entries!`);
        }

        const autoAdd = this.storageSettings.values.autoAdd ?? true;
        for (const id of reorderedDeviceIds) {
            const device = systemManager.getDeviceById<Online>(id);
            const supportedType = supportedTypes[device.type];
            if (!supportedType?.probe(device))
                continue;

            try {
                const mixins = (device.mixins || []).slice();
                if (!mixins.includes(this.id)) {
                    // don't sync this by default, as it's solely for automations
                    if (device.type === ScryptedDeviceType.Notifier)
                        continue;
                    // don't sync this because automations may randomly turn the siren on
                    // since it is exposed as a switch. there's no native siren type.
                    if (device.type === ScryptedDeviceType.Siren)
                        continue;
                    if (defaultIncluded[device.id] === includeToken)
                        continue;
                    if (!autoAdd)
                        continue;
                    mixins.push(this.id);
                    await device.setMixins(mixins);
                    defaultIncluded[device.id] = includeToken;
                }
            }
            catch (e) {
                console.error('error while checking device if syncable', e);
                this.log.a('Error while checking device if syncable. See Console.');
                continue;
            }

            if (this.mergedDevices.has(device.id)) {
                this.console.log(`${device.name} was merged into an existing Homekit accessory and will not be exposed independently`)
                continue;
            }

            this.console.log('adding', device.name);

            const accessory = await supportedType.getAccessory(device, this);
            if (accessory) {
                accessoryIds.add(id);

                maybeAddBatteryService(device, accessory);
                addAccessoryDeviceInfo(device, accessory);

                const mixinStorage = deviceManager.getMixinStorage(device.id, this.nativeId);
                const standalone = device.type === ScryptedDeviceType.Camera || device.type === ScryptedDeviceType.Doorbell ? mixinStorage.getItem('standalone') !== 'false' : mixinStorage.getItem('standalone') === 'true';
                if (!mixinStorage.getItem('standalone'))
                    mixinStorage.setItem('standalone', standalone.toString());
                const standaloneCategory = typeToCategory(device.type);
                if (standalone && standaloneCategory) {
                    this.standalones.set(device.id, accessory);

                    const storageSettings = new StorageSettings({
                        storage: mixinStorage,
                        onDeviceEvent: async () => {
                        }
                    }, createHAPUsernameStorageSettingsDict({
                        storage: mixinStorage,
                        get name() {
                            return device.name
                        }
                    },
                        undefined, 'Pairing'));
                    storageSettings.settings.pincode.persistedDefaultValue = randomPinCode();
                    storageSettings.settings.addIdentifyingMaterial.persistedDefaultValue = true;

                    const mixinConsole = deviceManager.getMixinConsole(device.id, this.nativeId);

                    let published = false;
                    let hasPublished = false;
                    const publish = async () => {
                        try {
                            published = true;
                            mixinConsole.log('Device is in accessory mode and is online. HomeKit services are being published.');

                            await this.publishAccessory(accessory, storageSettings.values.mac, storageSettings.values.pincode, standaloneCategory, storageSettings.values.portOverride, storageSettings.values.addIdentifyingMaterial);
                            if (!hasPublished) {
                                hasPublished = true;
                                storageSettings.values.qrCode = new QRCode(accessory.setupURI()).svg();
                                logConnections(mixinConsole, accessory, this.seenConnections);
                            }
                        }
                        catch (e) {
                            mixinConsole.error('There was an error publishing the standalone accessory', e);
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

                    try {
                        if (true) {
                            publish();
                        }
                        else {
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
                    }
                    catch (e) {
                        mixinConsole.error('There was an error publishing the standalone accessory', e);
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

        const username = this.storageSettings.values.mac
        const info = this.bridge.getService(Service.AccessoryInformation)!;
        info.updateCharacteristic(Characteristic.Manufacturer, "scrypted.app");
        info.updateCharacteristic(Characteristic.Model, "scrypted");
        info.updateCharacteristic(Characteristic.SerialNumber, username);
        info.updateCharacteristic(Characteristic.FirmwareRevision, packageJson.version);

        const bind = await this.getAdvertiserInterfaceBind();
        this.console.log('mdns bind address', bind);

        const publishInfo: PublishInfo = {
            username,
            port: this.storageSettings.values.portOverride,
            pincode: this.storageSettings.values.pincode,
            category: Categories.BRIDGE,
            addIdentifyingMaterial: true,
            advertiser: this.getAdvertiser(),
            bind,
        };

        this.bridge.publish(publishInfo, true).then(() => {
            this.storageSettings.values.qrCode = new QRCode(this.bridge.setupURI()).svg();
            logConnections(this.console, this.bridge, this.seenConnections);
        });

        systemManager.listen(async (eventSource, eventDetails, eventData) => {
            if (eventDetails.eventInterface !== ScryptedInterface.ScryptedDevice)
                return;

            if (eventDetails.property === ScryptedInterfaceProperty.id)
                return;

            const canMixin = await this.canMixin(eventSource.type, eventSource.interfaces);
            const includes = eventSource?.mixins?.includes(this.id);
            const has = accessoryIds.has(eventSource?.id) || this.mergedDevices.has(eventSource?.id);
            if (has && !canMixin) {
                this.console.log('restart event', eventSource?.id, eventDetails.property, eventData);
                this.log.a(`${eventSource.name} can no longer be synced. HomeKit plugin will reload momentarily.`);
                deviceManager.requestRestart();
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

    async canMixin(type: ScryptedDeviceType | string, interfaces: string[]) {
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

        if (interfaces.includes(ScryptedInterface.VideoCamera) && (type === ScryptedDeviceType.Doorbell || type === ScryptedDeviceType.Camera))
            ret.push(ScryptedInterface.Readme);

        return ret;
    }

    async getAdvertiserInterfaceBind() {
        let bind: string = this.storageSettings.values.advertiserAddresses;
        if (bind === 'All Addresses')
            bind = undefined;
        else if (!bind || bind === 'Default' || bind === 'Server Address')
            return getScryptedServerAddresses();
        return bind;
    }

    async publishAccessory(accessory: Accessory, username: string, pincode: string, category: Categories, port: number, addIdentifyingMaterial: boolean) {
        const bind = await this.getAdvertiserInterfaceBind();

        await accessory.publish({
            username,
            port,
            pincode,
            category,
            addIdentifyingMaterial,
            advertiser: this.getAdvertiser(),
            bind,
        });
    }

    async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: WritableDeviceState) {
        const options: SettingsMixinDeviceOptions<any> = {
            mixinProviderNativeId: this.nativeId,
            mixinDeviceInterfaces,
            group: "HomeKit",
            groupKey: "homekit",
            mixinDevice, mixinDeviceState,
        };
        let ret: CameraMixin | HomekitMixin<any>;

        if (canCameraMixin(mixinDeviceState.type, mixinDeviceInterfaces)) {
            ret = new CameraMixin(options);
            this.cameraMixins.set(ret.id, ret as any);
        }
        else {
            ret = new HomekitMixin(options);
        }

        ret.storageSettings.settings.pincode.persistedDefaultValue = randomPinCode();
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

export default HomeKitPlugin;
