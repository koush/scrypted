import sdk, { Settings, ScryptedDeviceBase, Setting, SettingValue, DeviceDiscovery, AdoptDevice, DiscoveredDevice, Device, ScryptedInterface, ScryptedDeviceType, DeviceProvider, Reboot, DeviceCreatorSettings } from "@scrypted/sdk";
import ReolinkProvider from "../main";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import { DevInfo } from "../probe";
import { ReolinkNvrCamera } from "./camera";
import { DeviceInputData, ReolinkNvrClient } from "./api";
import { connectCameraAPI, OnvifCameraAPI } from "../onvif-api";

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
        onvifPort: {
            subgroup: 'Advanced',
            title: 'ONVIF Port',
            placeholder: '8000',
            defaultValue: 8000,
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
    onvifClient: OnvifCameraAPI;
    onvifEmitter: ReturnType<OnvifCameraAPI['listenEvents']>;
    onvifStarting = false;
    // Bumped by stopOnvifEvents() so an in-flight startOnvifEvents() still awaiting the
    // network can detect it was torn down and abandon itself instead of resurrecting.
    onvifGeneration = 0;

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
        // Tear the ONVIF subscription down too so address/onvifPort changes take effect;
        // the device interval restarts it on the next tick via ensureOnvifEvents().
        await this.stopOnvifEvents();
        // await this.init();
    }

    async init() {
        const client = this.getClient();
        await client.login();
        const logger = this.getLogger();

        setInterval(async () => {
            // Start the hub-level ONVIF push subscription once cameras are loaded and
            // at least one has "Use ONVIF for Object Detection" enabled. No-op once running.
            this.ensureOnvifEvents().catch(() => { });

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

    async ensureOnvifEvents() {
        const someCameraWantsOnvif = [...this.cameraNativeMap.values()]
            .some(c => c?.storageSettings?.values?.useOnvifDetection);
        if (someCameraWantsOnvif)
            await this.startOnvifEvents();
        else
            await this.stopOnvifEvents();
    }

    async stopOnvifEvents() {
        // Nothing running and no start in flight -> nothing to tear down. (Avoids bumping
        // onvifGeneration on every idle 1s tick when no camera wants ONVIF.)
        if (!this.onvifClient && !this.onvifEmitter && !this.onvifStarting)
            return;
        // Invalidate any in-flight start (onvifStarting) so it abandons rather than
        // resurrecting a subscription, even before it has assigned onvifClient.
        this.onvifGeneration++;
        try { await this.onvifClient?.unsubscribe(); } catch (e) { }
        this.onvifEmitter = undefined;
        this.onvifClient = undefined;
    }

    async startOnvifEvents() {
        if (this.onvifEmitter || this.onvifStarting)
            return;
        this.onvifStarting = true;
        const generation = this.onvifGeneration;
        const logger = this.getLogger();
        // Held locally (not in this.onvifClient) until the subscription is fully
        // established, so an error after connect still has a handle to unsubscribe.
        let client: OnvifCameraAPI;
        try {
            const { ipAddress, onvifPort, username, password } = this.storageSettings.values;
            const address = `${ipAddress}:${onvifPort}`;
            client = await connectCameraAPI(address, username, password, logger, undefined);
            try { await client.supportsEvents(); } catch (e) { }
            // createSubscription() (createPullPointSubscription) is what starts the onvif
            // library's PullMessages loop; that loop both delivers events and keeps the
            // subscription alive, so it is not explicitly renewed. listenEvents() below only
            // attaches handlers to that loop's emissions. This mirrors the established
            // onvif-events.ts pattern (createSubscription -> listenEvents).
            // KNOWN LIMITATION (follow-up): there is no plugin-level liveness watchdog. If
            // the library's pull loop wedges on a non-retryable error, onvifEmitter/onvifClient
            // stay set and ensureOnvifEvents() considers it healthy, so it is never restarted.
            // For sleeping battery cameras this is hard to distinguish from a legitimately
            // quiet channel; revisit before depending on this as the sole motion source.
            await client.createSubscription();
            const emitter = client.listenEvents();
            emitter.on('onvifChannelEvent', (motion: boolean, className: string | undefined, channel: number) => {
                try {
                    this.routeOnvifEvent(motion, className, channel);
                } catch (e) {
                    logger.error('error routing onvif event', e);
                }
            });
            emitter.on('data', (xml: string) => {
                if (this.storageSettings.values.debugEvents)
                    logger.log(`ONVIF raw: ${xml}`);
            });
            // A teardown (stopOnvifEvents) raced this start; abandon it rather than
            // resurrecting a subscription that was meant to be torn down.
            if (generation !== this.onvifGeneration) {
                try { await client.unsubscribe(); } catch (e) { }
                return;
            }
            this.onvifClient = client;
            this.onvifEmitter = emitter;
            logger.log('Hub-level ONVIF event subscription started');
        } catch (e) {
            // The 1s device interval calls ensureOnvifEvents() again, so a failed start
            // is retried on the next tick; tear down the connected-but-unstored client
            // (the leak source) and clean up the partial state here.
            logger.error('Failed to start hub ONVIF events, will retry', e);
            try { await client?.unsubscribe(); } catch (e2) { }
            this.onvifEmitter = undefined;
            this.onvifClient = undefined;
        } finally {
            this.onvifStarting = false;
        }
    }

    // Routes an interpreted ONVIF push event (see OnvifCameraAPI.listenEvents) to the
    // camera on the matching channel. The ONVIF Source token's numeric value equals the
    // camera's stored rtspChannel (verified on a Home Hub Pro: token 001 -> rtspChannel 1
    // / Front Door, 005 -> rtspChannel 5 / Gate Area), so they are compared directly. This
    // is distinct from the RTSP stream-path index, which is rtspChannel + 1.
    routeOnvifEvent(motion: boolean, className: string | undefined, channel: number) {
        // Defensive: the emit side (onvif-api) only fires onvifChannelEvent when the channel
        // is set and motion||class is present, so these guards are normally unreachable; kept
        // so routeOnvifEvent stays safe if called from another path in the future.
        if (channel === undefined || channel === null)
            return;
        if (!motion && !className)
            return;

        const target = [...this.cameraNativeMap.values()].find(c =>
            c
            && Number(c.storageSettings.values.rtspChannel) === channel
            && c.storageSettings.values.useOnvifDetection);

        target?.triggerOnvifMotion(className);
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