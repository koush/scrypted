import { SettingsMixinDeviceOptions } from '@scrypted/common/src/settings-mixin';
import sdk, { DeviceProvider, MixinProvider, Online, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedInterfaceProperty, Setting, Settings } from '@scrypted/sdk';
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import packageJson from "../package.json";
import { getAddressOverride } from "./address-override";
import { maybeAddBatteryService } from './battery';
import { CameraMixin, canCameraMixin } from './camera-mixin';
import { SnapshotThrottle, supportedTypes } from './common';
import { Accessory, Bridge, Categories, Characteristic, ControllerStorage, MDNSAdvertiser, PublishInfo, Service } from './hap';
import { createHAPUsernameStorageSettingsDict, getHAPUUID, getRandomPort as createRandomPort, initializeHapStorage, logConnections, typeToCategory } from './hap-utils';
import { HomekitMixin, HOMEKIT_MIXIN } from './homekit-mixin';
import { randomPinCode } from './pincode';
import './types';
import { VIDEO_CLIPS_NATIVE_ID } from './types/camera/camera-recording-files';
import { VideoClipsMixinProvider } from './video-clips-provider';

const { systemManager, deviceManager } = sdk;

initializeHapStorage();
const includeToken = 4;

async function getAdvertiserInterfaceBind(bind: string) {
    if (bind === 'All Addresses')
        bind = undefined;
    else if (!bind || bind === 'Default' || bind === 'Server Address')
        bind = await getAddressOverride();
    return bind;
}

async function publishAccessory(accessory: Accessory, username: string, pincode: string, category: Categories, port: number, bind: string, advertiser: MDNSAdvertiser) {
    await accessory.publish({
        username,
        port,
        pincode,
        category,
        addIdentifyingMaterial: false,
        advertiser,
        bind,
    });
}

export class HomeKitPlugin extends ScryptedDeviceBase implements MixinProvider, Settings, DeviceProvider {
    bridge = new Bridge('Scrypted', getHAPUUID(this.storage));
    snapshotThrottles = new Map<string, SnapshotThrottle>();
    videoClips: VideoClipsMixinProvider;
    videoClipsId: string;
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
        lastKnownHomeHub: {
            hide: true,
            description: 'The last home hub to request a recording. Internally used to determine if a streaming request is coming from remote wifi.',
        },
    });

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
            this.log.a('Reload the HomeKit plugin to apply this change.');
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
                break;
        }
        return advertiser;
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

            const mixinStorage = deviceManager.getMixinStorage(device.id, this.nativeId);
            const standalone = device.type === ScryptedDeviceType.Camera || device.type === ScryptedDeviceType.Doorbell ? mixinStorage.getItem('standalone') !== 'false' : mixinStorage.getItem('standalone') === 'true';
            if (!mixinStorage.getItem('standalone'))
                mixinStorage.setItem('standalone', standalone.toString());
            if (standalone)
                continue;

            const accessory = await supportedType.getAccessory(device);
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

                this.bridge.addBridgedAccessory(accessory);
            }
        }

        this.storage.setItem('defaultIncluded', JSON.stringify(defaultIncluded));

        const username = this.storageSettings.values.mac
        const info = this.bridge.getService(Service.AccessoryInformation)!;
        info.updateCharacteristic(Characteristic.Manufacturer, "scrypted.app");
        info.updateCharacteristic(Characteristic.Model, "scrypted");
        info.updateCharacteristic(Characteristic.SerialNumber, username);
        info.updateCharacteristic(Characteristic.FirmwareRevision, packageJson.version);

        const bind = await getAdvertiserInterfaceBind(this.storageSettings.values.advertiserAddresses);
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

        this.bridge.publish(publishInfo, true);
        this.storageSettings.values.qrCode = this.bridge.setupURI();
        logConnections(this.console, this.bridge);

        systemManager.listen(async (eventSource, eventDetails, eventData) => {
            if (eventDetails.eventInterface !== ScryptedInterface.ScryptedDevice)
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

        if (interfaces.includes(ScryptedInterface.VideoCamera) && (type === ScryptedDeviceType.Doorbell || type === ScryptedDeviceType.Camera))
            ret.push(ScryptedInterface.Readme);

        return ret;
    }

    async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any }) {
        const device = systemManager.getDeviceById<Online>(mixinDeviceState.id);
        const mixinStorage = deviceManager.getMixinStorage(device.id, this.nativeId);
        const standalone = device.type === ScryptedDeviceType.Camera || device.type === ScryptedDeviceType.Doorbell ? mixinStorage.getItem('standalone') !== 'false' : mixinStorage.getItem('standalone') === 'true';
        if (!mixinStorage.getItem('standalone'))
            mixinStorage.setItem('standalone', standalone.toString());

        const bind = await getAdvertiserInterfaceBind(this.storageSettings.values.advertiserAddresses);

        if (!standalone)
            return createMixin(this.nativeId, mixinDevice, mixinDeviceInterfaces, mixinDeviceState, standalone, bind, this.getAdvertiser());

        const forked = sdk.fork<ReturnType<typeof fork>>();
        const { createMixin: cm } = await forked.result;

        const ret = await cm(this.nativeId, mixinDevice, mixinDeviceInterfaces, mixinDeviceState, standalone, bind, this.getAdvertiser());
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

async function createMixin(mixinProviderNativeId: string, mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any }, standalone: boolean, bind: string, advertiser: MDNSAdvertiser) {
    const options: SettingsMixinDeviceOptions<any> = {
        mixinProviderNativeId: mixinProviderNativeId,
        mixinDeviceInterfaces,
        group: "HomeKit",
        groupKey: "homekit",
        mixinDevice, mixinDeviceState,
    };

    let ret: CameraMixin | HomekitMixin<any>;
    if (canCameraMixin(mixinDeviceState.type, mixinDeviceInterfaces)) {
        ret = new CameraMixin(options);
    }
    else {
        ret = new HomekitMixin(options);
    }

    ret.storageSettings.settings.pincode.persistedDefaultValue = randomPinCode();

    if (!standalone)
        return ret;

    const device = systemManager.getDeviceById<Online>(ret.id);
    const supportedType = supportedTypes[device.type];
    if (!supportedType?.probe(device)) {
        ret.console.error('Accessory mode device is no longer HomeKit compatible.')
        return ret;
    }

    const accessory = await supportedType.getAccessory(device);

    const standaloneCategory = typeToCategory(device.type);
    if (!standaloneCategory) {
        ret.console.warn('Unable to publish accessory mode device. Could not find standalone category mapping for accessory', device.name, device.type);
        return ret;
    }

    const publish = async () => {
        try {
            ret.console.log('Device is in accessory mode and is online. HomeKit services are being published.');

            await publishAccessory(accessory, ret.storageSettings.values.mac, ret.storageSettings.values.pincode, standaloneCategory, ret.storageSettings.values.portOverride, bind, advertiser);
            ret.storageSettings.values.qrCode = accessory.setupURI();
            logConnections(ret.console, accessory);
        }
        catch (e) {
            ret.console.error('There was an error publishing the standalone accessory', e);
        }
    }
    publish();
}

export async function fork() {
    return {
        createMixin,
    }
}

export default HomeKitPlugin;
