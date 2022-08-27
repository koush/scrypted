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

export class TuyaController extends ScryptedDeviceBase implements DeviceProvider, DeviceDiscovery, Settings {
    cloud: TuyaCloud;
    pulsar: TuyaPulsar;
    cameras: Map<string, TuyaCamera> = new Map();

    constructor(nativeId?: string) {
        super(nativeId);
        this.discoverDevices(0);
    }

    private handlePulsarMessage(message: TuyaPulsarMessage) {
        const data = message.payload.data;
        const { devId, productKey } = data;

        const device = this.cloud?.cameras?.find(c => c.id === devId);

        if (data.bizCode) {
            if (device && (data.bizCode === 'online' || data.bizCode === 'offline')) {
                // Device status changed
                const isOnline = data.bizCode === 'online';
                device.online = isOnline;
                return this.cameras.get(devId);
            } else if (device && data.bizCode === 'delete') {
                // Device needs to be deleted
                // - devId
                // - uid

                const { uid } = data.bizData;
                // TODO: delete device
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

            return this.cameras.get(devId);
        }
    }

    async discoverDevices(duration: number) {
        const userId = this.getSetting('userId');
        const accessId = this.getSetting('accessId');
        const accessKey = this.getSetting('accessKey');
        const country = TUYA_COUNTRIES.find(value => value.country == this.getSetting('country'));

        this.log.clearAlerts();

        let missingItems: string[] = [];
    
        if (!userId)
            missingItems.push('User Id');

        if (!accessId)
            missingItems.push('Access Id');
    
        if (!accessKey)
            missingItems.push('Access Key');

        if (!country)
            missingItems.push('Country');

        if (missingItems.length > 0) {
            this.log.a(`You must provide your ${missingItems.join(', ')}.`);
            return;
        }

        if (!this.cloud) {
            this.cloud = new TuyaCloud(
                userId,
                accessId,
                accessKey,
                country
            );
        }

        // If it cannot fetch devices, then that means it's permission denied.
        // For some reason, when generating a token does not validate authorization.
        if (!await this.cloud.fetchDevices()) {
            this.log.a("Failed to log in with credentials. Please try again.");
            this.cloud = null;
            return;
        }

        this.log.a("Successsfully logged in with credentials! Now discovering devices.");

        if (this.pulsar) {
            this.pulsar.stop();
        }

        this.pulsar = new TuyaPulsar({
            accessId: accessId,
            accessKey: accessKey,
            url: getTuyaPulsarEndpoint(country)
        });

        this.pulsar.open(() => {
            this.log.i(`TulsaPulse: opened connection.`)
        });

        this.pulsar.message((ws, message) => {
            this.pulsar?.ackMessage(message.messageId);
            this.log.i(`TuyaPulse: message received: ${message}`);
            const tuyaDevice = this.handlePulsarMessage(message);
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

        this.pulsar.maxRetries(() => {
            this.log.e("There was an error trying to connect to Message Service (TuyaPulse). Connection Max Reconnection Timed Out");
        });

        this.pulsar.start();

        // Find devices 

        const devices: Device[] = [];

        // Camera Setup

        for (const camera of this.cloud.cameras || []) {
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
                    ScryptedInterface.VideoCamera
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

        // Handle any camera device that have a light switch

        for (const camera of this.cloud.cameras || []) {
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
                    ScryptedInterface.OnOff,
                ],
                type: ScryptedDeviceType.Light,
            }

            await deviceManager.onDevicesChanged({
                providerNativeId: camera.id,
                devices: [device]
            });
        }

        // Update devices with new state

        for (const device of devices) {
            await this.getDevice(device.nativeId).then(device => device?.updateState());
        }
    }

    async getDevice(nativeId: string) {
        if (this.cameras.has(nativeId)) {
            return this.cameras.get(nativeId);
        }

        const camera = this.cloud?.cameras?.find(camera => camera.id === nativeId);
        if (camera) {
            const ret = new TuyaCamera(this, nativeId);
            this.cameras.set(nativeId, ret);
            return ret;
        }

        throw new Error('device not found?');
    }

    // Settings 

    async getSettings(): Promise<Setting[]> {
        return [
            {
                key: 'userId',
                title: 'User Id',
                description: 'Required: You can find this information in Tuya IoT -> Cloud -> Devices -> Linked Devices.',
                value: this.getSetting('userId')
            },
            {
                key: 'accessId',
                title: 'Access Id',
                description: 'Requirerd: This is located on the main project.',
                value: this.getSetting('accessId')
            },
            {
                key: 'accessKey',
                title: 'Access Key/Secret',
                description: 'Requirerd: This is located on the main project.',
                type: 'password',
                value: this.getSetting('accessKey')
            },
            {
                key: 'country',
                title: 'Country',
                description: 'Required: This is the country where you registered your devices.',
                type: 'string',
                choices: TUYA_COUNTRIES.map(value => value.country),
                value: this.getSetting('country')
            }
        ]
    }

    getSetting(key: string): string | null {
        return this.storage.getItem(key);
    }

    async putSetting(key: string, value: string): Promise<void> {
        this.storage.setItem(key, value);
        this.discoverDevices(0);
    }
}

export default createInstanceableProviderPlugin("Tuya", nativeId => new TuyaController(nativeId));
