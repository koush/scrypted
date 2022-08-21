import { Device, DeviceDiscovery, DeviceProvider, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting, Settings, SettingValue } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import { StorageSettings } from '../../../common/src/settings';
import { TuyaCloud } from './tuya/cloud';
import { TuyaDevice } from './tuya/tuya.device';
import { createInstanceableProviderPlugin } from '@scrypted/common/src/provider-plugin';
import { TuyaCamera } from './camera';
import { TuyaSupportedCountry, TUYA_COUNTRIES } from './tuya/tuya.utils';

const { deviceManager } = sdk;

export class TuyaPlugin extends ScryptedDeviceBase implements DeviceProvider, DeviceDiscovery, Settings {
    api: TuyaCloud;
    cameras: Map<string, TuyaCamera> = new Map();

    settingsStorage = new StorageSettings(this, {
        userId: {
            title: 'User Id',
            description: 'Required: You can find this information in Tuya IoT -> Cloud -> Devices -> Linked Devices.',
            onPut: async () => this.discoverDevices(0),
        },
        accessId: {
            title: 'Access Id',
            description: 'Requirerd: This is located on the main project.',
            onPut: async () => this.discoverDevices(0),
        },
        accessKey: {
            title: 'Access Key/Secret',
            description: 'Requirerd: This is located on the main project.',
            type: 'password',
            onPut: async () => this.discoverDevices(0),
        },
        country: {
            title: 'Country',
            description: 'Required: This is the country where you registered your devices.',
            type: 'string',
            choices: TUYA_COUNTRIES.map(value => value.country),
            // mapPut: (oldValue, newValue) => TUYA_COUNTRIES.find(value => value.country === newValue),
            onPut: async () => this.discoverDevices(0)
            // mapGet: (value) => (value as TuyaSupportedCountry).country,
        }
    });

    constructor(nativeId?: string) {
        super(nativeId);
        this.discoverDevices(0);
    }

    async tryLogin() {
        const userId = this.settingsStorage.getItem('userId');
        const accessId = this.settingsStorage.getItem('accessId');
        const accessKey = this.settingsStorage.getItem('accessKey');
        const country = TUYA_COUNTRIES.find(value => value.country == this.settingsStorage.getItem('country'));
        if (!userId || 
            !accessId || 
            !accessKey ||
            !country
        ) {
            this.log.a('Enter your Tuya User Id, access Id, access key, and country to complete the setup.');
            throw new Error('User Id, access Id, access key, and country info are missing.');
        }

        this.api = new TuyaCloud(
            userId,
            accessId,
            accessKey,
            country
        );

        const response = await this.api.getUser();

        if (!response.success) {
            this.log.e("Failed to log in with credentials.");
            throw new Error("Failed to log in with credentials, please check if everything is correct.");
        }
    }

    getSettings(): Promise<Setting[]> {
        return this.settingsStorage.getSettings();
    }

    putSetting(key: string, value: SettingValue): Promise<void> {
        return this.settingsStorage.putSetting(key, value);
    }

    async discoverDevices(duration: number) {
        await this.tryLogin();

        this.log.clearAlerts();
        this.log.a("Successsfully logged in with credentials! Now discovering devices.");

        if (!await this.api.fetchDevices()) {
            this.log.e("Could not fetch devices.");
            throw new Error("There was an error fetching devices.");
        }

        const devices: Device[] = [];

        // Camera Setup

        for (const camera of this.api.cameras || []) {
            const nativeId = camera.id;

            const device: Device = {
                providerNativeId: this.nativeId,
                name: camera.name,
                nativeId,
                info: {
                    manufacturer: 'Tuya',
                    model: camera.model,
                    serialNumber: nativeId
                },
                type: TuyaDevice.isDoorbell(camera)
                    ? ScryptedDeviceType.Doorbell
                    : ScryptedDeviceType.Camera,
                interfaces: [
                    ScryptedInterface.Camera,
                    ScryptedInterface.VideoCamera,
                    ScryptedInterface.MotionSensor,
                    ScryptedInterface.Intercom,
                    ScryptedInterface.Online
                ]
            };

            if (TuyaDevice.isDoorbell(camera)) {
                device.interfaces.push(ScryptedInterface.BinarySensor);
            }

            if (TuyaDevice.hasStatusIndicator(camera)) {
                device.interfaces.push(ScryptedInterface.OnOff);
            }

            if (TuyaDevice.hasLightSwitch(camera)) {
                device.interfaces.push(ScryptedInterface.DeviceProvider);
            }

            devices.push(device);
        }

        await deviceManager.onDevicesChanged({
            providerNativeId: this.nativeId,
            devices
        });

        // Update devices with new state

        for (const device of devices) {
            this.getDevice(device.nativeId).then(device => device?.updateState());
        }

        // Handle any camera device that have a light switch

        for (const camera of this.api.cameras) {
            if (!TuyaDevice.hasLightSwitch(camera)) {
                continue;
            }
            const nativeId = camera.id + '-light';
            const device: Device = {
                providerNativeId: camera.id,
                name: camera.name + ' Light',
                nativeId,
                info: {
                    manufacturer: 'Tuya',
                    model: camera.model,
                    serialNumber: camera.id,
                },
                interfaces: [
                    ScryptedInterface.OnOff
                ],
                type: ScryptedDeviceType.Light,
            }

            await deviceManager.onDevicesChanged({
                providerNativeId: camera.id,
                devices: [device]
            });
        }
    }

    async getDevice(nativeId: string): Promise<TuyaCamera> {
        if (this.cameras.has(nativeId)) {
            return this.cameras.get(nativeId);
        }

        const camera = this.api.cameras.find(camera => camera.id === nativeId);
        if (camera) {
            const ret = new TuyaCamera(this, nativeId, camera);
            this.cameras.set(nativeId, ret);
            return ret;
        }

        throw new Error('device not found?');
    }
}

export default createInstanceableProviderPlugin("Tuya", nativeId => new TuyaPlugin(nativeId));
