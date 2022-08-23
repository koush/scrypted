import { Device, DeviceDiscovery, DeviceProvider, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting, Settings, SettingValue } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import { StorageSettings } from '../../../common/src/settings';
import { TuyaCloud } from './tuya/cloud';
import { TuyaDevice } from './tuya/device';
import { createInstanceableProviderPlugin } from '@scrypted/common/src/provider-plugin';
import { TuyaCamera } from './camera';
import { getTuyaPulsarEndpoint, TUYA_COUNTRIES } from './tuya/utils';
import { TuyaPulsar, TuyaPulsarMessage } from './tuya/pulsar';

const { deviceManager } = sdk;

export class TuyaPlugin extends ScryptedDeviceBase implements DeviceProvider, DeviceDiscovery, Settings {
    api: TuyaCloud;
    pulsar: TuyaPulsar;
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
            onPut: async () => this.discoverDevices(0)
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

        const success = await this.api.login();

        if (!success) {
            this.log.e("Failed to log in with credentials.");
            this.api = undefined;
            this.pulsar?.stop();
            this.pulsar = undefined;
            throw new Error("Failed to log in with credentials, please check if everything is correct.");
        }

        this.pulsar = new TuyaPulsar({
            accessId: accessId,
            accessKey: accessKey,
            url: getTuyaPulsarEndpoint(country)
        });

        this.pulsar.open(() => {
            this.log.i(`TulsaPulse: opening connection.`)
        });

        this.pulsar.message((ws, message) => {
            this.pulsar.ackMessage(message.messageId);
            this.log.i(`TuyaPulse: message received: ${message}`);
            const tuyaDevice = handleMessage(message);
            if (!tuyaDevice)
                return;
            tuyaDevice.updateState();
        });

        this.pulsar.reconnect(() => {
            this.log.i(`TuyaPulse: restarting connection.`);
        });

        this.pulsar.close((ws, ...args) => {
            this.log.w(`TuyaPulse: closed connection.`);
        });

        this.pulsar.error((ws, error) => {
            this.log.e(`TuyaPulse: ${error}`);
        });

        this.pulsar.start();

        const handleMessage = (message: TuyaPulsarMessage) => {
            const data = message.payload.data;
            const { devId, productKey } = data;

            const device = this.api.cameras?.find(c => c.id === devId);

            let returnDevice = false;

            if (data.bizCode) {
                if (!device && data.bizCode !== 'add') {
                    return;
                }

                if (data.bizCode === 'online' || data.bizCode === 'offline') {
                    // Device status changed
                    const isOnline = data.bizCode === 'online';
                    device.online = isOnline;
                    returnDevice = true;
                } else if (data.bizCode === 'delete') {
                    // Device needs to be deleted
                    // - devId
                    // - uid

                    const { uid } = data.bizData;
                } else if (data.bizCode === 'add') {
                    // TODO: There is a new device added, refetch
                }
            } else {
                if (!device) {
                    return;
                }

                const newStatus = data.status || [];

                newStatus.forEach(item => {
                    const index = device.status.findIndex(status => status.code == item.code);
                    if (index !== -1) {
                        device.status[index].value = item.value
                    }
                });

                returnDevice = true;
            }    

            if (returnDevice) {
                return this.cameras.get(devId);
            }
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
                    ScryptedInterface.VideoCamera,
                ]
            };

            if (TuyaDevice.isDoorbell(camera)) {
                device.interfaces.push(ScryptedInterface.BinarySensor);
            }

            if (TuyaDevice.hasStatusIndicator(camera)) {
                device.interfaces.push(ScryptedInterface.OnOff);
            }

            if (TuyaDevice.hasMotionDetection(camera)) {
                device.interfaces.push(ScryptedInterface.MotionSensor);
            }

            // Device Provider

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
                    ScryptedInterface.OnOff,
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
