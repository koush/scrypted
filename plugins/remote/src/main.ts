import { connectScryptedClient, ScryptedClientStatic } from '@scrypted/client/src/index';
import sdk, { BufferConverter, Battery, Device, DeviceCreator, DeviceCreatorSettings, DeviceManifest, DeviceProvider, FFmpegInput, ScryptedDevice, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, Setting, Settings, SettingValue, MediaObjectOptions, MediaManager } from '@scrypted/sdk';
import { StorageSettings } from '@scrypted/sdk/storage-settings';
import https from 'https';
import { v4 as uuidv4 } from 'uuid';
import { MediaObjectRemote } from '../../../server/src/plugin/plugin-api';
import { RpcPeer } from '../../../server/src/rpc';

const { deviceManager } = sdk;

export class MediaObject implements MediaObjectRemote {
    __proxy_props: any;

    constructor(public mimeType: string, public data: any, options: MediaObjectOptions) {
        this.__proxy_props = {
            mimeType,
        }
        if (options) {
            for (const [key, value] of Object.entries(options)) {
                if (RpcPeer.isTransportSafe(key))
                    this.__proxy_props[key] = value;
                (this as any)[key] = value;
            }
        }
    }

    async getData(): Promise<Buffer | string> {
        return Promise.resolve(this.data);
    }
}

interface RemoteMediaObject extends MediaObjectRemote {
    realMimeType: string;
}

class ScryptedRemoteInstance extends ScryptedDeviceBase implements DeviceProvider, Settings, BufferConverter {
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

    fromMimeType: string = ""
    toMimeType: string = ""

    constructor(nativeId: string) {
        super(nativeId);
        this.clearTryDiscoverDevices();


        this.fromMimeType = 'x-scrypted-remote/x-media-object-' + this.id;
        this.toMimeType = '*';
        sdk.mediaManager.addConverter(this);
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
            ScryptedDeviceType.Doorbell,
            ScryptedDeviceType.DeviceProvider,
            ScryptedDeviceType.API,
        ]
        if (!allowedTypes.includes(device.type)) {
            return null;
        }

        // only permit the following functional interfaces through
        const allowedInterfaces = [
            ScryptedInterface.VideoRecorder,
            ScryptedInterface.VideoClips,
            ScryptedInterface.EventRecorder,
            ScryptedInterface.VideoCamera,
            ScryptedInterface.Camera,
            ScryptedInterface.RTCSignalingChannel,
            ScryptedInterface.Battery,
            ScryptedInterface.MotionSensor,
            ScryptedInterface.AudioSensor,
            ScryptedInterface.DeviceProvider,
            ScryptedInterface.ObjectDetection,
        ];
        const intersection = allowedInterfaces.filter(i => device.interfaces.includes(i));
        if (intersection.length == 0) {
            return null;
        }

        // explicitly drop plugins if all they do is provide devices
        if (device.interfaces.includes(ScryptedInterface.ScryptedPlugin) && intersection.length == 1 && intersection[0] == ScryptedInterface.DeviceProvider) {
            return null;
        }

        // some extra interfaces that are nice to expose, but not needed
        const nonessentialInterfaces = [
            ScryptedInterface.Readme,
        ];
        const nonessentialIntersection = nonessentialInterfaces.filter(i => device.interfaces.includes(i));

        device.interfaces = intersection.concat(nonessentialIntersection);
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

        // for device providers, we intercept calls to load device representations
        // stored within this plugin instance, instead of directly from the remote
        if (device.interfaces.includes(ScryptedInterface.DeviceProvider)) {
            (<DeviceProvider><any>remoteDevice).getDevice = async (nativeId: string): Promise<Device> => {
                return <Device>this.devices.get(nativeId);
            }
            (<DeviceProvider><any>remoteDevice).releaseDevice = async (id: string, nativeId: string): Promise<any> => {
                // don't delete the device from the remote
                this.releaseDevice(id, nativeId);
            }
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
        });

        this.client.onClose = () => {
            this.console.log('client killed, reconnecting in 60s');
            setTimeout(async () => await this.clearTryDiscoverDevices(), 60000);
        }

        /* bjia56: since the MediaObject conversion isn't completely implemented, disable this for now
        const { rpcPeer } = this.client;
        const map = new WeakMap<RemoteMediaObject, MediaObject>();
        rpcPeer.nameDeserializerMap.set('MediaObject', {
            serialize(value, serializationContext) {
                throw new Error();
            },
            deserialize: (mo: RemoteMediaObject, serializationContext) => {
                let rmo = map.get(mo);
                if (rmo)
                    return rmo;
                rmo = new MediaObject(this.fromMimeType, mo, {});
                map.set(mo, rmo);
                // mo.realMimeType = mo.mimeType;
                // mo.mimeType = this.fromMimeType;
                // mo.getData = async() => mo as any;
                // mo.mediaManager = this.client.mediaManager;
                return rmo;
            },
        });
        */

        this.console.log(`Connected to remote Scrypted server. Remote server version: ${this.client.serverVersion}`)
    }

    async convert(data: RemoteMediaObject, fromMimeType: string, toMimeType: string, options?: MediaObjectOptions): Promise<any> {
        if (toMimeType.startsWith('x-scrypted-remote/x-media-object'))
            return data;
        let ret = await this.client.mediaManager.convertMediaObject(data, toMimeType);
        if (toMimeType === ScryptedMimeTypes.FFmpegInput) {
            const ffmpegInput = JSON.parse(ret.toString()) as FFmpegInput;
            if (ffmpegInput.urls?.[0]) {
                ffmpegInput.url = ffmpegInput.urls[0];
                delete ffmpegInput.urls;
                ret = Buffer.from(JSON.stringify(ffmpegInput));
            }
        }
        else if (toMimeType === ScryptedMimeTypes.LocalUrl) {
            ret = Buffer.from(new URL(ret.toString(),this.settingsStorage.values.baseUrl).toString());
        }
        return sdk.mediaManager.createMediaObject(ret, toMimeType);
        return ret;
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

        // construct initial (flat) list of devices from the remote server
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

        // it may be that a parent device was filtered out, so reparent these child devices to
        // the top level
        devices.map(device => {
            if (!this.devices.has(device.providerNativeId)) {
                device.providerNativeId = this.nativeId;
            }
        });

        // group devices by parent provider id
        const providerDeviceMap = new Map<string, Device[]>();
        devices.map(device => {
            // group devices by parent provider id
            if (!providerDeviceMap.has(device.providerNativeId)) {
                providerDeviceMap.set(device.providerNativeId, [device]);
            } else {
                providerDeviceMap.get(device.providerNativeId).push(device);
            }
        })

        // first register the top level devices, then register the remaining
        // devices by provider id
        // top level devices are discovered one by one to avoid clobbering
        providerDeviceMap.get(this.nativeId).map(async device => {
            await deviceManager.onDeviceDiscovered(device);
        });
        for (let [providerNativeId, devices] of providerDeviceMap) {
            await deviceManager.onDevicesChanged(<DeviceManifest>{
                devices,
                providerNativeId,
            });
        }

        // setup relevant proxies and monkeypatches for all devices
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
                ScryptedInterface.BufferConverter,
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
