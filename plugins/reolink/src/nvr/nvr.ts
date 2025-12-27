import sdk, { Settings, ScryptedDeviceBase, Setting, SettingValue, DeviceDiscovery, AdoptDevice, DiscoveredDevice, Device, ScryptedInterface, ScryptedDeviceType, DeviceProvider, Reboot, DeviceCreatorSettings } from "@scrypted/sdk";
import ReolinkProvider from "../main";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import { DevInfo } from "../probe";
import { ReolinkNvrCamera } from "./camera";
import { DeviceInputData, ReolinkNvrClient } from "./api";

export class ReolinkNvrDevice extends ScryptedDeviceBase implements Settings, DeviceDiscovery, DeviceProvider, Reboot {
    storageSettings = new StorageSettings(this, {
        debugEvents: {
            title: 'Debug Events',
            type: 'boolean',
            immediate: true,
        },
        ipAddress: {
            title: 'IP address',
            type: 'string',
            onPut: async () => await this.reinit()
        },
        username: {
            title: 'Username',
            placeholder: 'admin',
            defaultValue: 'admin',
            type: 'string',
            onPut: async () => await this.reinit()
        },
        password: {
            title: 'Password',
            type: 'password',
            onPut: async () => await this.reinit()
        },
        httpPort: {
            title: 'HTTP Port',
            subgroup: 'Advanced',
            defaultValue: 80,
            placeholder: '80',
            type: 'number',
            onPut: async () => await this.reinit()
        },
        rtspPort: {
            subgroup: 'Advanced',
            title: 'RTSP Port',
            placeholder: '554',
            defaultValue: 554,
            type: 'number',
            onPut: async () => await this.reinit()
        },
        rtmpPort: {
            subgroup: 'Advanced',
            title: 'RTMP Port',
            placeholder: '1935',
            defaultValue: 1935,
            type: 'number',
            onPut: async () => await this.reinit()
        },
        abilities: {
            json: true,
            hide: true,
            defaultValue: {}
        },
        devicesData: {
            json: true,
            hide: true,
            defaultValue: {}
        },
        hubData: {
            json: true,
            hide: true,
            defaultValue: {}
        },
        loginSession: {
            json: true,
            hide: true,
        },
    });
    plugin: ReolinkProvider;
    client: ReolinkNvrClient;
    discoveredDevices = new Map<string, {
        device: Device;
        description: string;
        rtspChannel: number;
    }>();
    lastHubInfoCheck = undefined;
    lastErrorsCheck = undefined;
    lastDevicesStatusCheck = undefined;
    cameraNativeMap = new Map<string, ReolinkNvrCamera>();
    processing = false;

    constructor(nativeId: string, plugin: ReolinkProvider) {
        super(nativeId);
        this.plugin = plugin;

        setTimeout(async () => {
            await this.init();
        }, 5000);
    }

    async reboot(): Promise<void> {
        const client = this.getClient();
        await client.reboot();
    }

    getLogger() {
        return this.console;
    }

    async reinit() {
        this.client = undefined;
        // await this.init();
    }

    async init() {
        const client = this.getClient();
        await client.login();
        const logger = this.getLogger();

        setInterval(async () => {
            if (this.processing || !client) {
                return;
            }
            this.processing = true;
            try {
                const now = Date.now();

                if (!this.lastErrorsCheck || (now - this.lastErrorsCheck > 60 * 1000)) {
                    this.lastErrorsCheck = now;
                    await client.checkErrors();
                }

                if (!this.lastHubInfoCheck || now - this.lastHubInfoCheck > 1000 * 60 * 5) {
                    logger.log('Starting Hub info data fetch');
                    this.lastHubInfoCheck = now;
                    const { abilities, hubData, } = await client.getHubInfo();
                    const { devicesData, channelsResponse, response } = await client.getDevicesInfo();
                    logger.log('Hub info data fetched');
                    if (this.storageSettings.values.debugEvents) {
                        logger.log(`${JSON.stringify({ abilities, hubData, devicesData, channelsResponse, response })}`);
                    }
                    this.storageSettings.values.abilities = abilities;
                    this.storageSettings.values.hubData = hubData;
                    this.storageSettings.values.devicesData = devicesData;

                    await this.discoverDevices(true);
                }

                const devicesMap = new Map<number, DeviceInputData>();
                let anyBattery = false;
                let anyAwaken = false;

                this.cameraNativeMap.forEach((camera) => {
                    if (camera) {
                        const channel = camera.storageSettings.values.rtspChannel;

                        const abilities = camera.getAbilities();
                        if (abilities) {
                            const hasBattery = camera.hasBattery();
                            const hasPirEvents = camera.hasPirEvents();
                            const hasFloodlight = camera.hasFloodlight();
                            const sleeping = camera.sleeping;
                            const { hasPtz } = camera.getPtzCapabilities();
                            devicesMap.set(Number(channel), {
                                hasFloodlight,
                                hasBattery,
                                hasPirEvents,
                                hasPtz,
                                sleeping
                            });

                            if (hasBattery && !anyBattery) {
                                anyBattery = true;
                            }

                            if (!sleeping && !anyAwaken) {
                                anyAwaken = true;
                            }
                        }
                    }
                });

                const anyDeviceFound = devicesMap.size > 0;

                if (anyDeviceFound) {
                    const eventsRes = await client.getEvents(devicesMap);

                    if (this.storageSettings.values.debugEvents) {
                        logger.debug(`Events call result: ${JSON.stringify(eventsRes)}`);
                    }
                    this.cameraNativeMap.forEach((camera) => {
                        if (camera) {
                            const channel = camera.storageSettings.values.rtspChannel;
                            const cameraEventsData = eventsRes?.parsed[channel];
                            if (cameraEventsData) {
                                camera.processEvents(cameraEventsData);
                            }
                        }
                    });
                }

                if (anyBattery) {
                    const { batteryInfoData, response } = await client.getBatteryInfo(devicesMap);

                    if (this.storageSettings.values.debugEvents) {
                        logger.debug(`Battery info call result: ${JSON.stringify({ batteryInfoData, response })}`);
                    }

                    this.cameraNativeMap.forEach((camera) => {
                        if (camera) {
                            const channel = camera.storageSettings.values.rtspChannel;
                            const cameraBatteryData = batteryInfoData[channel];
                            if (cameraBatteryData) {
                                camera.processBatteryData(cameraBatteryData);
                            }
                        }
                    });
                }

                if (anyDeviceFound) {
                    if (!this.lastDevicesStatusCheck || (now - this.lastDevicesStatusCheck > 15 * 1000) && anyAwaken) {
                        this.lastDevicesStatusCheck = now;
                        const { deviceStatusData, response } = await client.getStatusInfo(devicesMap);

                        if (this.storageSettings.values.debugEvents) {
                            logger.info(`Status info raw result: ${JSON.stringify({ deviceStatusData, response })}`);
                        }

                        this.cameraNativeMap.forEach((camera) => {
                            if (camera) {
                                const channel = camera.storageSettings.values.rtspChannel;
                                const cameraDeviceStatusData = deviceStatusData[channel];
                                if (cameraDeviceStatusData) {
                                    camera.processDeviceStatusData(cameraDeviceStatusData);
                                }
                            }
                        });
                    }
                }
            } catch (e) {
                this.console.error('Error on events flow', e);
            } finally {
                this.processing = false;
            }
        }, 1000);
    }

    getClient() {
        if (!this.client) {
            const { ipAddress, httpPort, password, username } = this.storageSettings.values;
            const address = `${ipAddress}:${httpPort}`;
            this.client = new ReolinkNvrClient(
                address, 
                username, 
                password, 
                this.console,
                this,
            );
        }
        return this.client;
    }

    updateDeviceInfo(devInfo: DevInfo) {
        const info = this.info || {};
        info.ip = this.storageSettings.values.ipAddress;
        info.serialNumber = devInfo.serial;
        info.firmware = devInfo.firmVer;
        info.version = devInfo.firmVer;
        info.model = devInfo.model;
        info.manufacturer = 'Reolink';
        info.managementUrl = `http://${info.ip}`;
        this.info = info;
    }

    async getSettings(): Promise<Setting[]> {
        const settings = await this.storageSettings.getSettings();

        return settings;
    }

    async putSetting(key: string, value: SettingValue): Promise<void> {
        return this.storageSettings.putSetting(key, value);
    }


    async releaseDevice(id: string, nativeId: string) {
        this.cameraNativeMap.delete(nativeId);
    }

    async getDevice(nativeId: string): Promise<ReolinkNvrCamera> {
        let device = this.cameraNativeMap.get(nativeId);

        if (!device) {
            device = new ReolinkNvrCamera(nativeId, this);
            this.cameraNativeMap.set(nativeId, device);
        }

        return device;
    }

    buildNativeId(uid: string) {
        return `${this.nativeId}-${uid}`;
    }

    getCameraInterfaces() {
        return [
            ScryptedInterface.VideoCameraConfiguration,
            ScryptedInterface.Camera,
            ScryptedInterface.MotionSensor,
            ScryptedInterface.VideoTextOverlays,
            ScryptedInterface.MixinProvider,
            ScryptedInterface.VideoCamera,
            ScryptedInterface.Settings,
        ];
    }

    async syncEntitiesFromRemote() {
        const api = this.getClient();
        const { channels, devicesData } = await api.getDevicesInfo();

        for (const channel of channels) {
            const { channelStatus, channelInfo } = devicesData[channel];
            const name = channelStatus.name || `Channel ${channel}`;

            const nativeId = this.buildNativeId(channelStatus.uid);
            const device: Device = {
                nativeId,
                name,
                providerNativeId: this.nativeId,
                interfaces: this.getCameraInterfaces() ?? [],
                type: ScryptedDeviceType.Camera,
                info: {
                    manufacturer: 'Reolink',
                    model: channelInfo.typeInfo
                }
            };

            if (sdk.deviceManager.getNativeIds().includes(nativeId)) {
                // const device = sdk.systemManager.getDeviceById<Device>(this.pluginId, nativeId);
                // sdk.deviceManager.onDeviceDiscovered(device);
                continue;
            }

            if (this.discoveredDevices.has(nativeId)) {
                continue;
            }

            this.discoveredDevices.set(nativeId, {
                device,
                description: `${name}`,
                rtspChannel: channel,
            });
        }
    }

    async discoverDevices(scan?: boolean): Promise<DiscoveredDevice[]> {
        if (scan) {
            await this.syncEntitiesFromRemote();
        }

        return [...this.discoveredDevices.values()].map(d => ({
            ...d.device,
            description: d.description,
        }));
    }

    async adoptDevice(adopt: AdoptDevice): Promise<string> {
        const entry = this.discoveredDevices.get(adopt.nativeId);

        if (!entry)
            throw new Error('device not found');

        await this.onDeviceEvent(ScryptedInterface.DeviceDiscovery, await this.discoverDevices());

        await sdk.deviceManager.onDeviceDiscovered(entry.device);

        const device = await this.getDevice(adopt.nativeId);
        this.console.log('Adopted device', entry, device?.name);
        device.storageSettings.values.rtspChannel = entry.rtspChannel;

        this.discoveredDevices.delete(adopt.nativeId);
        return device?.id;
    }
}