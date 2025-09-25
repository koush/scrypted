import { createInstanceableProviderPlugin, enableInstanceableProviderMode, isInstanceableProviderModeEnabled } from '@scrypted/common/src/provider-plugin';
import { sleep } from "@scrypted/common/src/sleep";
import sdk, { AdoptDevice, Device, DeviceDiscovery, DeviceProvider, DiscoveredDevice, ObjectDetectionResult, ObjectsDetected, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting, Settings } from "@scrypted/sdk";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import axios, { ResponseType } from "axios";
import https from 'https';
import { UnifiCamera } from "./camera";
import { debounceFingerprintDetected, debounceMotionDetected } from "./camera-sensors";
import { UnifiLight } from "./light";
import { UnifiLock } from "./lock";
import { UnifiSensor } from "./sensor";
import { ProtectApi, ProtectCameraConfigInterface, ProtectEventAddInterface, ProtectEventPacket } from "./unifi-protect";

const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
});

const { deviceManager } = sdk;

const filter = [
    'channels',
    'recordingSchedules',
    'stats',
    'wifiConnectionState',
    'upSince',
    'uptime',
    'lastSeen',
    'eventStats',
    'voltage',
    'phyRate',
    'wifiConnectionState',
];

export class UnifiProtect extends ScryptedDeviceBase implements Settings, DeviceProvider, DeviceDiscovery {
    authorization: string | undefined;
    accessKey: string | undefined;
    cameras = new Map<string, UnifiCamera>()
    unifiSensors = new Map<string, UnifiSensor>();
    lights = new Map<string, UnifiLight>();
    locks = new Map<string, UnifiLock>();
    api: ProtectApi;
    startup: Promise<void>;
    runningEvents = new Map<string, { promise: Promise<unknown>, resolve: (value: unknown) => void }>();

    constructor(nativeId?: string) {
        super(nativeId);

        this.startup = this.connectProtect()

        this.updateManagementUrl();
    }

    handleUpdatePacket(packet: ProtectEventPacket) {
        if (packet.header.action !== "update") {
            return;
        }
        if (!packet.header.id) {
            return;
        }

        const device = this.api.bootstrap.cameras?.find(c => c.id === packet.header.id)
            || this.api.bootstrap.lights?.find(c => c.id === packet.header.id)
            || (this.api.bootstrap.doorlocks as any)?.find(c => c.id === packet.header.id)
            || this.api.bootstrap.sensors?.find(c => c.id === packet.header.id);

        if (!device) {
            return;
        }

        Object.assign(device, packet.payload);

        const nativeId = this.getNativeId(device, false);

        const ret = this.unifiSensors.get(nativeId) ||
            this.locks.get(nativeId) ||
            this.cameras.get(nativeId) ||
            this.lights.get(nativeId);

        const keys = new Set(Object.keys(packet.payload));
        for (const k of filter) {
            keys.delete(k);
        }
        if (keys.size > 0 && this.storageSettings.values.debugLog)
            ret?.console.log('update packet', packet.payload);
        return ret;
    }

    async relogin() {
        const ip = this.getSetting('ip');
        const username = this.getSetting('username');
        const password = this.getSetting('password');
        const loginResult = await this.api.login(ip, username, password);
        if (!loginResult) {
            this.log.a('Login failed. Check credentials.');
            return;
        }

        if (!await this.api.getBootstrap()) {
            this.reconnect('refresh failed')();
            return;
        }
        return loginResult;
    }

    public async loginFetch(url: string, options?: { method?: string, signal?: AbortSignal, responseType?: ResponseType }, relogin = false) {
        try {
            const api = this.api as any;
            const headers: Record<string, string> = {};
            for (const [header, value] of api.headers) {
                headers[header] = value;
            }

            return await axios(url, {
                responseType: options?.responseType,
                method: options?.method,
                headers,
                httpsAgent,
                signal: options?.signal,
            });
        }
        catch (e) {
            if (relogin) {
                await this.relogin();
                return this.loginFetch(url, options);
            }
        }
    }

    listener(updatePacket: ProtectEventPacket) {
        if (!updatePacket)
            return;

        // this.console.log('updatePacket', updatePacket);

        const unifiDevice = this.handleUpdatePacket(updatePacket);

        switch (updatePacket.header.modelKey) {
            case "sensor":
            case "doorlock":
            case "light":
            case "camera": {
                if (!unifiDevice) {
                    this.console.log('unknown device, sync needed?', updatePacket.header.id);
                    return;
                }
                if (updatePacket.header.action !== "update") {
                    unifiDevice.console.log('non update', updatePacket.header.action);
                    return;
                }
                unifiDevice.updateState();

                if (updatePacket.header.modelKey === "doorlock")
                    return;

                const payload = updatePacket.payload as ProtectCameraConfigInterface;

                if (updatePacket.header.modelKey !== "camera")
                    return;

                const unifiCamera = unifiDevice as UnifiCamera;
                if (payload.lastRing && unifiCamera.binaryState && payload.lastSeen > payload.lastRing + 25000) {
                    // something weird happened, lets set unset any binary sensor state
                    unifiCamera.binaryState = false;
                }

                unifiCamera.lastSeen = payload.lastSeen;
                break;
            }
            case "event": {
                const payload = updatePacket.payload as ProtectEventAddInterface;
                if (updatePacket.header.action !== "add") {
                    if (payload.end && updatePacket.header.id) {
                        // unifi reports the event ended but it seems to take a moment before the snapshot
                        // is actually ready.
                        setTimeout(() => {
                            const running = this.runningEvents.get(updatePacket.header.id);
                            running?.resolve?.(undefined)
                        }, 2000);
                    }
                    return;
                }

                if (!payload.camera)
                    return;
                const nativeId = this.getNativeId({ id: payload.camera }, false);
                const unifiCamera = this.cameras.get(nativeId);

                if (!unifiCamera) {
                    this.console.log('unknown device event, sync needed?', payload, nativeId);
                    return;
                }

                const detectionId = payload.id;
                const actionId = updatePacket.header.id;

                let resolve: (value: unknown) => void;
                const promise = new Promise(r => resolve = r);
                promise.finally(() => {
                    this.runningEvents.delete(detectionId);
                    this.runningEvents.delete(actionId);
                })
                this.runningEvents.set(detectionId, { resolve, promise });
                this.runningEvents.set(actionId, { resolve, promise });
                setTimeout(() => resolve(undefined), 60000);


                unifiCamera.console.log('event', payload);

                let detections: ObjectDetectionResult[] = [];

                // const event = {
                //     type: 'smartDetectZone',
                //     start: 1713211066646,
                //     score: 80,
                //     smartDetectTypes: [ 'licensePlate', 'vehicle' ],
                //     smartDetectEvents: [],
                //     metadata: { licensePlate: { name: 'ABCDEFG', confidenceLevel: 90 } },
                //     camera: '64b2e59f0106eb03e4001210',
                //     partition: null,
                //     user: null,
                //     id: '661d86bf03e69c03e408d62a',
                //     modelKey: 'event'
                // }

                if (payload.type === 'smartDetectZone' || payload.type === 'smartDetectLine') {
                    unifiCamera.resetDetectionTimeout();

                    detections = payload.smartDetectTypes.map(type => ({
                        className: type,
                        score: payload.score,
                        label: payload.metadata?.[type]?.name,
                    }));
                }
                else {
                    detections = [{
                        className: payload.type,
                        score: payload.score,
                    }];

                    if (payload.type === 'ring') {
                        unifiCamera.binaryState = true;
                        unifiCamera.lastRing = payload.start;
                        unifiCamera.resetRingTimeout();
                    }
                    else if (payload.type === 'motion') {
                        debounceMotionDetected(unifiCamera);
                    }
                    else if (payload.type === 'fingerprintIdentified') {
                        const anypay = payload as any;
                        const userId: string = anypay.metadata?.fingerprint?.userId || anypay.metadata?.fingerprint?.ulpId;
                        if (userId) {
                            debounceFingerprintDetected(unifiCamera);
                            detections[0].label = userId;
                            detections[0].labelScore = 1;
                        }
                    }
                }

                const detection: ObjectsDetected = {
                    detectionId,
                    timestamp: Date.now(),
                    detections,
                };
                unifiCamera.onDeviceEvent(ScryptedInterface.ObjectDetector, detection);

                unifiCamera.lastSeen = payload.start;
                break;
            }
        }
    };

    debugLog(message: string, ...parameters: any[]) {
        if (this.storageSettings.values.debugLog)
            this.console.log(message, ...parameters);
    }


    reconnecting = false;
    wsTimeout: NodeJS.Timeout;
    reconnect(reason: string) {
        return async () => {
            if (this.reconnecting)
                return;
            this.reconnecting = true;
            this.api?.reset();
            this.console.error('Event Listener reconnecting in 10 seconds:', reason);
            await sleep(10000);
            this.connectProtect();
        }
    }

    async discoverDevices(): Promise<DiscoveredDevice[]> {
        return this.discoverDevicesInternal(false);
    }

    async discoverDevicesInternal(skipCheck: boolean): Promise<DiscoveredDevice[]> {
        if (!this.api?.bootstrap)
            return [];

        let settings: Setting[] = undefined;
        if (this.failedDevices.size) {
            settings = [
                {
                    title: 'Add Device',
                    key: 'addDevice',
                    type: 'radiopanel',
                    choices: [
                        'Add New Device',
                        'Reassociate Existing Device'
                    ],
                    value: 'Add New Device',
                },
                {
                    radioGroups: ['Reassociate Existing Device'],
                    key: 'reassociate',
                    title: 'Device',
                    description: 'These devices previously failed to load. Select one to reassociate it with a new Unifi Protect device.',
                    choices: Array.from(this.failedDevices.values()),
                }
            ];
        }

        const nativeIds = new Set(deviceManager.getNativeIds());

        const checkNativeId = (device: any) => {
            if (skipCheck)
                return false;
            const nativeId = this.getNativeId(device, true);
            if (nativeId && nativeIds.has(nativeId))
                return true;
            return false;
        }

        const devices: DiscoveredDevice[] = [];
        for (const camera of this.api.bootstrap.cameras) {
            if (!camera.isAdopted || camera.isAdoptedByOther) {
                continue;
            }

            if (checkNativeId(camera))
                continue;

            const managementUrl = `https://${this.storage.getItem('ip')}/protect/timelapse/${camera.id}`;

            const isDoorbell = camera.featureFlags.isDoorbell || camera.featureFlags.hasChime;
            const d: DiscoveredDevice = {
                settings,
                description: camera.host || camera.id,
                name: camera.name,
                nativeId: camera.id,
                info: {
                    manufacturer: camera.isThirdPartyCamera ? undefined : 'Ubiquiti',
                    model: camera.type,
                    firmware: camera.firmwareVersion,
                    version: camera.hardwareRevision,
                    ip: camera.host,
                    serialNumber: camera.id,
                    mac: camera.mac,
                    managementUrl,
                },
                interfaces: [
                    ScryptedInterface.Settings,
                    ScryptedInterface.Camera,
                    ScryptedInterface.VideoCamera,
                    ScryptedInterface.VideoCameraMask,
                    ScryptedInterface.VideoCameraConfiguration,
                    ScryptedInterface.MotionSensor,
                ],
                type: isDoorbell
                    ? ScryptedDeviceType.Doorbell
                    : ScryptedDeviceType.Camera,
            };
            if (isDoorbell) {
                d.interfaces.push(ScryptedInterface.BinarySensor);
            }
            if (camera.featureFlags.hasSpeaker) {
                d.interfaces.push(ScryptedInterface.Intercom);
            }
            if (camera.featureFlags.hasLcdScreen) {
                d.interfaces.push(ScryptedInterface.Notifier);
            }
            if (camera.featureFlags.hasPackageCamera) {
                d.interfaces.push(ScryptedInterface.DeviceProvider);
            }
            if (camera.featureFlags.hasLedStatus) {
                d.interfaces.push(ScryptedInterface.OnOff);
            }
            if (camera.featureFlags.canOpticalZoom) {
                d.interfaces.push(ScryptedInterface.PanTiltZoom);
            }
            d.interfaces.push(ScryptedInterface.ObjectDetector);

            devices.push(d);
        }

        for (const sensor of this.api.bootstrap.sensors || []) {
            if (!sensor.isAdopted || sensor.isAdoptedByOther) {
                continue;
            }

            if (checkNativeId(sensor))
                continue;

            const d: DiscoveredDevice = {
                settings,
                description: sensor.host || sensor.id,
                name: sensor.name,
                nativeId: sensor.id,
                info: {
                    manufacturer: 'Ubiquiti',
                    model: sensor.type,
                    ip: sensor.host,
                    firmware: sensor.firmwareVersion,
                    version: sensor.hardwareRevision,
                    serialNumber: sensor.id,
                },
                interfaces: [
                    // todo light sensor
                    ScryptedInterface.Thermometer,
                    ScryptedInterface.HumiditySensor,
                    ScryptedInterface.AudioSensor,
                    ScryptedInterface.BinarySensor,
                    ScryptedInterface.MotionSensor,
                    ScryptedInterface.FloodSensor,
                ],
                type: ScryptedDeviceType.Sensor,
            };

            devices.push(d);
        }

        for (const light of this.api.bootstrap.lights || []) {
            if (!light.isAdopted || light.isAdoptedByOther) {
                continue;
            }

            if (checkNativeId(light))
                continue;


            const d: DiscoveredDevice = {
                settings,
                description: light.host || light.id,
                name: light.name,
                nativeId: light.id,
                info: {
                    manufacturer: 'Ubiquiti',
                    model: light.type,
                    ip: light.host,
                    firmware: light.firmwareVersion,
                    version: light.hardwareRevision,
                    serialNumber: light.id,
                },
                interfaces: [
                    // todo light sensor
                    ScryptedInterface.OnOff,
                    ScryptedInterface.Brightness,
                    ScryptedInterface.MotionSensor,
                ],
                type: ScryptedDeviceType.Light,
            };

            devices.push(d);
        }

        for (const lock of (this.api.bootstrap.doorlocks as any) || []) {
            if (!lock.isAdopted || lock.isAdoptedByOther) {
                continue;
            }

            if (checkNativeId(lock))
                continue;

            const d: DiscoveredDevice = {
                settings,
                description: lock.host || lock.id,
                name: lock.name,
                nativeId: lock.id,
                info: {
                    manufacturer: 'Ubiquiti',
                    model: lock.type,
                    ip: lock.host,
                    firmware: lock.firmwareVersion,
                    version: lock.hardwareRevision.toString(),
                    serialNumber: lock.id,
                },
                interfaces: [
                    ScryptedInterface.Lock,
                ],
                type: ScryptedDeviceType.Lock,
            };

            devices.push(d);
        }

        return devices;
    }

    async adoptDevice(device: AdoptDevice): Promise<string> {
        let mappedNativeId = device.nativeId;

        if (device.settings?.addDevice === 'Reassociate Existing Device') {
            if (!device.settings.reassociate)
                throw new Error('Select a device to reassociate.');

            const failedNativeId = [...this.failedDevices.entries()].find(([id, name]) => name === device.settings.reassociate)?.[0];
            if (!failedNativeId)
                throw new Error('Failed to find device to reassociate.');

            const idToNativeId = this.storageSettings.values.idToNativeId || {};
            idToNativeId[device.nativeId] = failedNativeId;
            this.storageSettings.values.idToNativeId = idToNativeId;
            mappedNativeId = failedNativeId;
            return this.adoptDeviceInternal(device, true, mappedNativeId);
        }

        return this.adoptDeviceInternal(device, false, mappedNativeId);
    }

    async adoptDeviceInternal(device: { nativeId: string, settings?: any }, skipCheck: boolean, mappedNativeId = device.nativeId): Promise<string> {
        const discoveredDevices = await this.discoverDevicesInternal(skipCheck);
        const d = discoveredDevices.find(d => d.nativeId === device.nativeId);
        if (!d)
            throw new Error('device not found');

        const id = await deviceManager.onDeviceDiscovered({
            ...d,
            nativeId: mappedNativeId,
            interfaces: d.interfaces!,
            providerNativeId: this.nativeId,
        });

        this.getDevice(mappedNativeId).then(device => device?.updateState());

        let camera = this.api.bootstrap.cameras.find(c => c.id === d.nativeId);
        if (camera) {
            let needUpdate = false;
            for (const channel of camera.channels) {
                if (channel.idrInterval !== 4 || !channel.isRtspEnabled) {
                    if (channel.idrInterval !== 4)
                        this.console.log('attempting to change invalid idr interval. if this message shows up again on plugin reload, it failed. idr:', channel.idrInterval);
                    channel.idrInterval = 4;
                    channel.isRtspEnabled = true;
                    needUpdate = true;
                }
            }

            if (needUpdate) {
                const updated = await this.api.updateDevice(camera, {
                    channels: camera.channels,
                });
                if (!camera) {
                    this.log.a('Unable to enable RTSP and IDR interval on camera. Is this an admin account?');
                }
                else {
                    camera = updated;
                }
            }

            const devices: Device[] = [];

            const providerNativeId = this.getNativeId(camera, true);

            if (camera.featureFlags.hasPackageCamera) {
                const nativeId = providerNativeId + '-packageCamera';
                const d: Device = {
                    providerNativeId,
                    name: camera.name + ' Package Camera',
                    nativeId,
                    info: {
                        manufacturer: 'Ubiquiti',
                        model: camera.type,
                        firmware: camera.firmwareVersion,
                        version: camera.hardwareRevision,
                        serialNumber: camera.id,
                    },
                    interfaces: [
                        ScryptedInterface.Camera,
                        ScryptedInterface.VideoCamera,
                        ScryptedInterface.MotionSensor,
                    ],
                    type: ScryptedDeviceType.Camera,
                };
                devices.push(d);
            }

            if (camera.featureFlags.hasFingerprintSensor) {
                const nativeId = providerNativeId + '-fingerprintSensor';
                const d: Device = {
                    providerNativeId,
                    name: camera.name + ' Fingerprint Sensor',
                    nativeId,
                    info: {
                        manufacturer: 'Ubiquiti',
                        model: camera.type,
                        firmware: camera.firmwareVersion,
                        version: camera.hardwareRevision,
                        serialNumber: camera.id,
                    },
                    interfaces: [
                        ScryptedInterface.BinarySensor,
                    ],
                    type: ScryptedDeviceType.Sensor,
                };
                devices.push(d);
            }

            if (devices.length) {
                await deviceManager.onDevicesChanged({
                    providerNativeId: mappedNativeId,
                    devices,
                });
            }
        }

        return id;
    }

    async connectProtect() {
        this.api?.reset();
        this.reconnecting = false;
        clearTimeout(this.wsTimeout);

        const ip = this.getSetting('ip');
        const username = this.getSetting('username');
        const password = this.getSetting('password');

        this.log.clearAlerts();

        if (!ip) {
            this.log.a('Must provide IP address.');
            return
        }

        if (!username) {
            this.log.a('Must provide username.');
            return
        }

        if (!password) {
            this.log.a('Must provide password.');
            return
        }

        if (!this.api) {
            this.api = new ProtectApi({
                debug() { },
                error: (...args) => {
                    this.console.error(...args);
                },
                info() { },
                warn() { },
            });
        }

        try {
            const loginResult = await this.relogin();
            if (!loginResult) {
                this.log.a('Login failed. Check credentials.');
                return;
            }

            if (!await this.api.getBootstrap()) {
                this.reconnect('refresh failed')();
                return;
            }

            const resetWsTimeout = () => {
                clearTimeout(this.wsTimeout);
                this.wsTimeout = setTimeout(() => this.reconnect('timeout'), 5 * 60 * 1000);
            };
            resetWsTimeout();

            this.api.on('message', message => {
                resetWsTimeout();
                this.listener(message);
            });

            const nativeIds = new Set(deviceManager.getNativeIds());

            // refresh all adopted devices and update state.
            const adoptedDevices = [
                ...this.api.bootstrap.cameras || [],
                ...this.api.bootstrap.sensors || [],
                ...this.api.bootstrap.lights || [],
                ...(this.api.bootstrap.doorlocks as any) || [],
            ]
                .filter(device => device.isAdopted && !device.isAdoptedByOther);

            if (adoptedDevices.length) {
                // clean up the idToNativeId mapping
                const idToNativeId = this.storageSettings.values.idToNativeId || {};
                for (const k of Object.keys(idToNativeId)) {
                    if (!adoptedDevices.find(d => d.id === k)) {
                        delete idToNativeId[k];
                    }
                }
                this.storageSettings.values.idToNativeId = idToNativeId;
            }

            for (const device of adoptedDevices) {
                const nativeId = this.getNativeId(device, true);
                if (nativeId && nativeIds.has(nativeId)) {
                    this.adoptDeviceInternal({ nativeId: device.id }, true, nativeId).catch(() => { });
                }
            }
        }
        catch (e) {
            this.log.a(`login error: ${e}`);
            this.console.error('login error', e);
        }
    }

    async releaseDevice(id: string, nativeId: string): Promise<void> {
        this.cameras.delete(nativeId);
        this.unifiSensors.delete(nativeId);
        this.lights.delete(nativeId);
        this.locks.delete(nativeId);
    }

    failedDevices = new Map<string, string>();

    async getDevice(nativeId: string): Promise<UnifiCamera | UnifiLight | UnifiSensor | UnifiLock> {
        await this.startup;
        try {
            if (this.cameras.has(nativeId))
                return this.cameras.get(nativeId);
            if (this.unifiSensors.has(nativeId))
                return this.unifiSensors.get(nativeId);
            if (this.lights.has(nativeId))
                return this.lights.get(nativeId);
            if (this.locks.has(nativeId))
                return this.locks.get(nativeId);

            const id = this.findId(nativeId);
            const camera = this.api.bootstrap.cameras.find(camera => camera.id === id);
            if (camera) {
                const ret = new UnifiCamera(this, nativeId, camera);
                this.cameras.set(nativeId, ret);
                return ret;
            }
            const sensor = this.api.bootstrap.sensors.find(sensor => sensor.id === id);
            if (sensor) {
                const ret = new UnifiSensor(this, nativeId, sensor);
                this.unifiSensors.set(nativeId, ret);
                return ret;
            }
            const light = this.api.bootstrap.lights.find(light => light.id === id);
            if (light) {
                const ret = new UnifiLight(this, nativeId, light);
                this.lights.set(nativeId, ret);
                return ret;
            }
            const lock = (this.api.bootstrap.doorlocks as any)?.find(lock => lock.id === id);
            if (lock) {
                const ret = new UnifiLock(this, nativeId, lock);
                this.locks.set(nativeId, ret);
                return ret;
            }
        }
        finally {
            this.failedDevices.delete(nativeId);
        }

        const logger = deviceManager.getDeviceLogger(nativeId);
        logger.a('Device not found in Unifi Protect. This may be caused by Unifi Protect changing the device id. Reassociate the device in the Unifi Protect plugin to continue using it.');

        const d = new ScryptedDeviceBase(nativeId);
        const uniqueName = `${d.name} (${nativeId})`;
        this.failedDevices.set(nativeId, uniqueName);

        throw new Error('device not found?');
    }

    getSetting(key: string): string {
        return this.storage.getItem(key);
    }

    forceReconnect() {
        this.connectProtect();
        this.updateManagementUrl();
    }

    storageSettings = new StorageSettings(this, {
        username: {
            title: 'Username',
            onPut: () => this.forceReconnect(),
        },
        password: {
            title: 'Password',
            type: 'password',
            onPut: () => this.forceReconnect(),
        },
        ip: {
            title: 'Unifi Protect IP',
            placeholder: '192.168.1.100',
            onPut: () => this.forceReconnect(),
        },
        useConnectionHost: {
            title: 'Use Connection Host',
            group: 'Advanced',
            description: 'Uses the connection host to connect to the RTSP Stream. This is required in stacked UNVR configurations. Disabling this setting will always use the configured Unifi Protect IP as the RTSP stream IP.',
            type: 'boolean',
        },
        debugLog: {
            title: 'Debug Log',
            description: 'Enable debug log to see additional logging.',
            group: 'Advanced',
            type: 'boolean',
        },
        idToNativeId: {
            hide: true,
            json: true,
            defaultValue: {},
        },
        idMaps: {
            hide: true,
            json: true,
            defaultValue: {
                anonymousDeviceId: {},
                nativeId: {},
            },
        }
    });

    findId(nativeId: string) {
        // the id and nativeId will be the same unless unifi clobbers the id.

        // new path
        const found = Object.entries(this.storageSettings.values.idToNativeId || {}).find(([id, nid]) => nid === nativeId);
        if (found)
            return found[0];

        // legacy path
        const id = this.storageSettings.values.idMaps.nativeId?.[nativeId] || nativeId;
        const existingNativeId = this.storageSettings.values.idToNativeId?.[id];
        if (!existingNativeId || nativeId === existingNativeId)
            return id;

        return nativeId;
    }

    getNativeId(device: { id?: string, mac?: string; anonymousDeviceId?: string, host?: string }, update: boolean): string {
        if (device.id) {
            const nativeId = this.storageSettings.values.idToNativeId?.[device.id];
            if (nativeId)
                return nativeId;
            // at some point later this will return the id itself and update the mapping.
            // return device.id;

            // for now fall back to old behavior which will be removed at a later date.
        }

        const { id, mac, anonymousDeviceId, host } = device;
        const idMaps = this.storageSettings.values.idMaps;

        // try to find an existing nativeId given the mac and anonymous device id
        const found = (mac && idMaps.mac?.[mac])
            || (anonymousDeviceId && idMaps.anonymousDeviceId?.[anonymousDeviceId])
            || (id && idMaps.id?.[id])
            || (host && idMaps.host?.[host])
            ;

        // use the found id if one exists (device got provisioned a new id), otherwise use the id provided by the device.
        const nativeId = found || id;

        if (!update)
            return nativeId;

        // Remove any existing mappings to this nativeId
        const cleanDict = (dict: Record<string, string>) => {
            if (!dict) return;
            const entries = Object.entries(dict);
            for (const [key, value] of entries) {
                if (value === nativeId) {
                    delete dict[key];
                }
            }
        }

        // Clean existing mappings before adding new ones
        idMaps.mac ||= {};
        idMaps.anonymousDeviceId ||= {};
        idMaps.host ||= {};
        idMaps.id ||= {};
        idMaps.nativeId ||= {};

        cleanDict(idMaps.mac);
        cleanDict(idMaps.anonymousDeviceId);
        cleanDict(idMaps.host);
        cleanDict(idMaps.id);

        // map the mac, host, and anonymous device id to the native id.
        if (mac) {
            idMaps.mac[mac] = nativeId;
        }
        if (anonymousDeviceId) {
            idMaps.anonymousDeviceId[anonymousDeviceId] = nativeId;
        }
        if (host) {
            idMaps.host[host] = nativeId;
        }

        // map the id and native id to each other.
        idMaps.id[id] = nativeId;
        idMaps.nativeId[nativeId] = id;

        this.storageSettings.values.idMaps = idMaps;

        // update mappings for new behavior.
        const idToNativeId = this.storageSettings.values.idToNativeId || {};
        idToNativeId[id] = nativeId;
        this.storageSettings.values.idToNativeId = idToNativeId;
        return nativeId;
    }

    async getSettings(): Promise<Setting[]> {
        const ret = await this.storageSettings.getSettings();

        if (!isInstanceableProviderModeEnabled()) {
            ret.push({
                key: 'instance-mode',
                title: 'Multiple Unifi Protect Applications',
                value: '',
                description: 'To add more than one Unifi Protect application, you will need to migrate the plugin to multi-application mode. Type "MIGRATE" in the textbox to confirm.',
                placeholder: 'MIGRATE',
                group: 'Advanced',
            });
        }
        return ret;
    }

    updateManagementUrl() {
        const ip = this.storage.getItem('ip');
        if (!ip)
            return;
        const info = this.info || {};
        const managementUrl = `https://${ip}/protect/dashboard`;
        if (info.managementUrl !== managementUrl) {
            info.managementUrl = managementUrl;
            this.info = info;
        }
    }

    async putSetting(key: string, value: string | number) {
        if (key === 'instance-mode') {
            if (value === 'MIGRATE') {
                await enableInstanceableProviderMode();
            }
            return;
        }

        return this.storageSettings.putSetting(key, value);
    }
}

export default createInstanceableProviderPlugin("Unifi Protect Application", nativeid => new UnifiProtect(nativeid));
