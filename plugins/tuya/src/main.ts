import { Device, DeviceDiscovery, DeviceProvider, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting, Settings, SettingValue } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import { StorageSettings } from '../../../common/src/settings';
import { TuyaCloud } from './tuya/cloud';
import { TuyaDevice } from './tuya/tuya.device';
import { createInstanceableProviderPlugin } from '@scrypted/common/src/provider-plugin';
import { TuyaCamera } from './camera';

const { deviceManager } = sdk;

export class TuyaCameraPlugin extends ScryptedDeviceBase implements DeviceProvider, DeviceDiscovery, Settings {
    api: TuyaCloud;
    cameras: Map<string, TuyaCamera> = new Map();

    settingsStorage = new StorageSettings(this, {
        userId: {
            title: 'User Id',
            description: 'Required: You can find this information in Tuya IoT -> Cloud -> Devices -> Linked Devices.',
            onPut: async () => this.clearTryDiscoverDevices(),
        },
        accessId: {
            title: 'Access Id',
            description: 'Requirerd: This is located on the main project.',
            onPut: async () => this.clearTryDiscoverDevices(),
        },
        accessKey: {
            title: 'Access Key/Secret',
            description: 'Requirerd: This is located on the main project.',
            type: 'password',
            onPut: async () => this.clearTryDiscoverDevices(),
        },
        countryCode: {
            title: 'Country Code',
            description: 'Your two integer country code.',
            type: 'number',
            value: 1,
            onPut: async (oldValue, newValue) => {
                await this.tryLogin(newValue);
                await this.discoverDevices(0);
            },
        },
    });

    constructor(nativeId?: string) {
        super(nativeId);
        this.discoverDevices(0);
    }

    clearTryDiscoverDevices() {
        // add code to clear any refresh tokens, etc, here. login changed.
        this.discoverDevices(0);
    }

    async tryLogin(code?: number) {
        const createTuyaApi = async () => {
            this.api = new TuyaCloud(
                this.settingsStorage.values.userId,
                this.settingsStorage.values.accessId,
                this.settingsStorage.values.accessKey,
                code || 1
            );
        }

        if (!this.settingsStorage.values.userId || !this.settingsStorage.values.accessId || !this.settingsStorage.values.accessKey) {
            this.log.a('Enter your Tuya User Id, access Id and access key to complete the setup.');
            throw new Error('User Id, access Id, and access key are missing.');
        }

        await createTuyaApi();

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

        this.log.d("Successsfully logged in with credentials! Now discovering devices.");

        if (!await this.api.fetchDevices()) {
            this.log.e("Could not fetch devices.");
            throw new Error("There was an error fetching devices.");
        }

        const devices: Device[] = [];

        for (const tuyaDevice of this.api.cameras) {
            const nativeId = tuyaDevice.id;

            const device: Device = {
                providerNativeId: this.nativeId,
                name: tuyaDevice.name,
                nativeId,
                info: {
                    manufacturer: 'Tuya',
                    model: tuyaDevice.model,
                    serialNumber: nativeId
                },
                type: TuyaDevice.isDoorbell(tuyaDevice)
                    ? ScryptedDeviceType.Doorbell
                    : ScryptedDeviceType.Camera,
                interfaces: [
                    // ScryptedInterface.Settings,
                    ScryptedInterface.Camera,
                    ScryptedInterface.VideoCamera,
                    ScryptedInterface.MotionSensor,
                    ScryptedInterface.Intercom,
                    ScryptedInterface.Online
                ]
            };

            if (TuyaDevice.isDoorbell(tuyaDevice)) {
                device.interfaces.push(ScryptedInterface.BinarySensor);
            }

            if (TuyaDevice.hasStatusIndicator(tuyaDevice)) {
                device.interfaces.push(ScryptedInterface.OnOff);
            }

            if (TuyaDevice.hasLightSwitch(tuyaDevice)) {
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

        // Handle any devices that have a light switch

        for (const camera of this.api.cameras) {
            if (!TuyaDevice.hasLightSwitch(camera))
                continue;
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

export default createInstanceableProviderPlugin("Tuya Camera Plugin", nativeId => new TuyaCameraPlugin(nativeId));
