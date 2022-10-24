import { Device, DeviceDiscovery, DeviceProvider, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting, Settings } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
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
        let refreshDevice = false;

        const device = this.cloud?.cameras?.find(c => c.id === devId);

        let pulsarMessageLogs: string[] = ['Received new TuyaPulsar Message:'];

        if (data.bizCode) {
            if (device && (data.bizCode === 'online' || data.bizCode === 'offline')) {
                // Device status changed
                const isOnline = data.bizCode === 'online';
                device.online = isOnline;
                refreshDevice = true;
                pulsarMessageLogs.push(`- Changed device to ${data.bizCode} for ${device.name}`);
            } else if (device && data.bizCode === 'delete') {
                // Device needs to be deleted
                // - devId
                // - uid

                pulsarMessageLogs.push(`- Delete ${device.name} from homekit`);
                const { uid } = data.bizData;
                // TODO: delete device
            } else if (data.bizCode === 'add') {
                // TODO: There is a new device added, refetch
                pulsarMessageLogs.push(`- Add new device with devId: ${data.devId} to homekit`);
            } else {
                pulsarMessageLogs.push(`- Unknown bizCode: ${data.bizCode} with data: ${JSON.stringify(data.bizData)}.`);
            }
        } else if (device && data.status) {
            const newStatus = data.status || [];

            pulsarMessageLogs.push(`- ${device.name} received new status updates:`);

            newStatus.forEach(item => {
                pulsarMessageLogs.push(`\t- ${JSON.stringify(item)}`);

                const index = device.status.findIndex(status => status.code == item.code);
                if (index !== -1) {
                    device.status[index].value = item.value
                }
            });

            refreshDevice = true;
        } else {
            pulsarMessageLogs.push(`- Unknown TuyaPulsar message received: ${JSON.stringify(data)}`);
        }

        pulsarMessageLogs.push('');
        this.log.i(pulsarMessageLogs.join('\n'));

        if (refreshDevice) {
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
                    ScryptedInterface.VideoCamera,
                    ScryptedInterface.Online
                ]
            };

            let deviceInfo: string[] = [`Creating camera device for: \n- ${camera.name}`];

            if (TuyaDevice.isDoorbell(camera)) {
                deviceInfo.push(`- Detected as a Doorbell`);
                device.interfaces.push(ScryptedInterface.BinarySensor);
            }

            if (TuyaDevice.hasStatusIndicator(camera)) {
                deviceInfo.push(`- Has Status Indicator`);
                device.interfaces.push(ScryptedInterface.OnOff);
            }

            if (TuyaDevice.hasMotionDetection(camera)) {
                deviceInfo.push(`- Motion Detection Supported`);
                device.interfaces.push(ScryptedInterface.MotionSensor);
            }

            // TODO: Wait until Tuya implements better security auth
            // if (await TuyaDevice.supportsWebRTC(camera, this.cloud)) {
            //     deviceInfo.push(`- WebRTC Supported with Intercom`);
            //     device.interfaces.push(ScryptedInterface.RTCSignalingChannel);
            // }

            // Device Provider

            if (TuyaDevice.hasLightSwitch(camera)) {
                deviceInfo.push(`- Has Light Switch`);
                device.interfaces.push(ScryptedInterface.DeviceProvider);
            }

            deviceInfo.push(`- Status:`);
            for (let status of camera.status) {
                deviceInfo.push(`\t${status.code}: ${status.value}`);
            }

            deviceInfo.push(`- Functions:`);
            for (let func of camera.functions) {
                deviceInfo.push(`\t${func.code}`);
            }

            deviceInfo.push(``);
            this.log.i(deviceInfo.join('\n\t'));
    
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
                    ScryptedInterface.Online
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
