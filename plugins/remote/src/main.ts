import { Device, DeviceProvider, DeviceCreator, DeviceCreatorSettings, ScryptedDevice, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting, Settings, Battery, VideoCamera, SettingValue, RequestMediaStreamOptions, MediaObject, DeviceManifest} from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import { StorageSettings } from '@scrypted/sdk/storage-settings';
import { connectScryptedClient, ScryptedClientStatic } from '@scrypted/client';
import https from 'https';
import { v4 as uuidv4 } from 'uuid';

const { deviceManager } = sdk;

class ScryptedRemoteInstance extends ScryptedDeviceBase implements DeviceProvider, Settings {
    client: ScryptedClientStatic = null;

    devices = new Map<string, ScryptedDevice>();

    settingsStorage = new StorageSettings(this, {
        baseUrl: {
            title: 'Base URL',
            placeholder: 'https://localhost:10443',
            onPut: async () => await this.clearTryDiscoverDevices(),
        },
        username: {
            title: 'Username',
            onPut: async () => await this.clearTryDiscoverDevices(),
        },
        password: {
            title: 'Password',
            type: 'password',
            onPut: async () => await this.clearTryDiscoverDevices(),
        },
    });

    constructor(nativeId: string) {
        super(nativeId);
        this.clearTryDiscoverDevices();
    }

    /**
     * Checks the given remote device to see if it can be correctly imported by this plugin.
     * Returns the (potentially modified) device that is allowed, or null if the device cannot
     * be imported.
     *
     * @param device
     * The local device representation. Will be modified in-place and returned.
     */
    filtered(device: Device): Device {
        // only permit the following device types through
        const allowedTypes = [
            ScryptedDeviceType.Camera,
            ScryptedDeviceType.DeviceProvider,
        ]
        if (!allowedTypes.includes(device.type)) {
            return null;
        }

        // only permit the following interfaces through
        const allowedInterfaces = [
            ScryptedInterface.Readme,
            ScryptedInterface.VideoCamera,
            ScryptedInterface.Camera,
            ScryptedInterface.RTCSignalingChannel,
            ScryptedInterface.Battery,
            ScryptedInterface.MotionSensor,
            ScryptedInterface.AudioSensor,
            ScryptedInterface.DeviceProvider,
            ScryptedInterface.ObjectDetector,
        ];
        const intersection = allowedInterfaces.filter(i => device.interfaces.includes(i));
        if (intersection.length == 0) {
            return null;
        }
        device.interfaces = intersection;

        return device;
    }

    /**
     * Configures relevant proxies for the local device representation and the remote device.
     * Listeners are added for interface property updates, and select remote function calls are
     * intercepted to tweak arguments for better remote integration.
     *
     * @param device
     * The local device representation.
     *
     * @param remoteDevice
     * The RPC reference to the remote device.
     */
    setupProxies(device: Device, remoteDevice: ScryptedDevice) {
        // set up event listeners for all the relevant interfaces
        device.interfaces.map(iface => remoteDevice.listen(iface, (source, details, data) => {
            if (!details.property) {
                deviceManager.onDeviceEvent(device.nativeId, details.eventInterface, data);
            } else {
                deviceManager.getDeviceState(device.nativeId)[details.property] = data;
            }
        }));

        // for certain interfaces with fixed state, transfer the initial values over
        if (device.interfaces.includes(ScryptedInterface.Battery)) {
            deviceManager.getDeviceState(device.nativeId).batteryLevel = (<Battery>remoteDevice).batteryLevel;
        }

        // since the remote may be using rebroadcast, explicitly request the external
        // address for video streams
        if (device.interfaces.includes(ScryptedInterface.VideoCamera)) {
            const remoteGetVideoStream = (<VideoCamera><any>remoteDevice).getVideoStream;
            async function newGetVideoStream(options?: RequestMediaStreamOptions): Promise<MediaObject> {
                if (!options) {
                    options = {};
                }
                (<any>options).route = "external";
                return await remoteGetVideoStream(options);
            }
            (<VideoCamera><any>remoteDevice).getVideoStream = newGetVideoStream;
        }

        // for device providers, we need to translate the nativeId
        if (device.interfaces.includes(ScryptedInterface.DeviceProvider)) {
            const plugin = this;
            async function newGetDevice(nativeId: string): Promise<Device> {
                return <Device>plugin.devices.get(nativeId);
            }
            async function newReleaseDevice(id: string, nativeId: string): Promise<any> {
                // don't delete the device from the remote
                plugin.releaseDevice(id, nativeId);
            }
            (<DeviceProvider><any>remoteDevice).getDevice = newGetDevice;
            (<DeviceProvider><any>remoteDevice).releaseDevice = newReleaseDevice;
        }
    }

    /**
     * Resets the connection to the remote Scrypted server and attempts to reconnect
     * and rediscover remoted devices.
     */
    async clearTryDiscoverDevices(): Promise<void> {
        await this.tryLogin();
        // bjia56:
        // there's some race condition with multi-tier device discovery that I haven't
        // sorted out, but it appears to work fine if we run discovery twice
        await this.discoverDevices(0);
        await this.discoverDevices(0);
    }

    async tryLogin(): Promise<void> {
        this.client = null;

        if (!this.settingsStorage.values.baseUrl || !this.settingsStorage.values.username || !this.settingsStorage.values.password) {
            this.console.log("Initializing remote Scrypted login requires the base URL, username, and password");
            return;
        }

        const httpsAgent = new https.Agent({
            rejectUnauthorized: false,
        });
        this.client = await connectScryptedClient({
            baseUrl: this.settingsStorage.values.baseUrl,
            pluginId: '@scrypted/core',
            username: this.settingsStorage.values.username,
            password: this.settingsStorage.values.password,
            axiosConfig: {
                httpsAgent,
            },
        })
        this.console.log(`Connected to remote Scrypted server. Remote server version: ${this.client.serverVersion}`)
    }

    getSettings(): Promise<Setting[]> {
        return this.settingsStorage.getSettings();
    }

    putSetting(key: string, value: SettingValue): Promise<void> {
        return this.settingsStorage.putSetting(key, value);
    }

    async discoverDevices(duration: number): Promise<void> {
        if (!this.client) {
            return
        }

        const state = this.client.systemManager.getSystemState();
        const devices = <Device[]>[];
        for (const id in state) {
            const remoteDevice = this.client.systemManager.getDeviceById(id);
            const remoteProviderDevice = this.client.systemManager.getDeviceById(remoteDevice.providerId);
            const remoteProviderNativeId = remoteProviderDevice?.id == remoteDevice.id ? undefined : remoteProviderDevice?.id;

            const nativeId = `${this.nativeId}:${remoteDevice.id}`;
            const device = this.filtered(<Device>{
                name: remoteDevice.name,
                type: remoteDevice.type,
                interfaces: remoteDevice.interfaces,
                info: remoteDevice.info,
                nativeId: nativeId,
                providerNativeId: remoteProviderNativeId ? `${this.nativeId}:${remoteProviderNativeId}` : this.nativeId,
            });
            if (!device) {
                this.console.log(`Device ${remoteDevice.name} is not supported, ignoring`)
                continue;
            }

            this.console.log(`Found ${remoteDevice.name}\n${JSON.stringify(device, null, 2)}`);
            this.devices.set(device.nativeId, remoteDevice);
            devices.push(device)
        }

        const providerDeviceMap = new Map<string, Device[]>();
        devices.map(device => {
            // group devices by parent provider id
            if (!providerDeviceMap.has(device.providerNativeId)) {
                providerDeviceMap.set(device.providerNativeId, [device]);
            } else {
                providerDeviceMap.get(device.providerNativeId).push(device);
            }
        })

        await deviceManager.onDevicesChanged(<DeviceManifest>{
            devices: providerDeviceMap.get(this.nativeId), // first register the top level devices
            providerNativeId: this.nativeId,
        });
        for (let [providerNativeId, devices] of providerDeviceMap) {
            await deviceManager.onDevicesChanged(<DeviceManifest>{
                devices,
                providerNativeId,
            });
        }

        devices.map(device => this.setupProxies(device, this.devices.get(device.nativeId)));
        this.console.log(`Discovered ${devices.length} devices`);
    }

    async getDevice(nativeId: string): Promise<Device> {
        if (!this.devices.has(nativeId)) {
            throw new Error(`${nativeId} does not exist`);
        }
        return <Device>this.devices.get(nativeId);
    }

    async releaseDevice(id: string, nativeId: string): Promise<void> {
        this.devices.delete(nativeId)
    }
}

class ScryptedRemotePlugin extends ScryptedDeviceBase implements DeviceCreator, DeviceProvider {
    remotes = new Map<string, ScryptedRemoteInstance>();

    constructor() {
        super();
    }

    async getDevice(nativeId: string): Promise<Device> {
        if (!this.remotes.has(nativeId)) {
            this.remotes.set(nativeId, new ScryptedRemoteInstance(nativeId));
        }
        return this.remotes.get(nativeId) as Device;
    }

    async releaseDevice(id: string, nativeId: string): Promise<void> {
        return;
    }

    async getCreateDeviceSettings(): Promise<Setting[]> {
        return [
            {
                key: 'name',
                title: 'Name',
            },
            {
                key: 'baseUrl',
                title: 'Base URL',
                placeholder: 'https://localhost:10443',
            },
            {
                key: 'username',
                title: 'Username',
            },
            {
                key: 'password',
                title: 'Password',
                type: 'password',
            },
        ];
    }

    async createDevice(settings: DeviceCreatorSettings): Promise<string> {
        const name = settings.name?.toString();
        const url = settings.baseUrl?.toString();
        const username = settings.username?.toString();
        const password = settings.password?.toString();

        const nativeId = uuidv4();
        await deviceManager.onDeviceDiscovered(<Device>{
            nativeId,
            name,
            interfaces: [
                ScryptedInterface.Settings,
                ScryptedInterface.DeviceProvider
            ],
            type: ScryptedDeviceType.DeviceProvider,
        });

        const remote = await this.getDevice(nativeId) as ScryptedRemoteInstance;
        remote.storage.setItem("baseUrl", url);
        remote.storage.setItem("username", username);
        remote.storage.setItem("password", password);
        await remote.clearTryDiscoverDevices();
        return nativeId;
    }
}

export default new ScryptedRemotePlugin();
