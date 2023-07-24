import sdk, { ScryptedDeviceBase, DeviceProvider, Settings, Setting, ScryptedDeviceType, Device, ScryptedInterface, ObjectsDetected, ObjectDetectionResult } from "@scrypted/sdk";
import { ProtectApi, ProtectApiUpdates, ProtectNvrUpdatePayloadCameraUpdate, ProtectNvrUpdatePayloadEventAdd } from "./unifi-protect";
import { createInstanceableProviderPlugin, enableInstanceableProviderMode, isInstanceableProviderModeEnabled } from '@scrypted/common/src/provider-plugin';
import { defaultSensorTimeout, UnifiCamera } from "./camera";
import { FeatureFlagsShim, LastSeenShim } from "./shim";
import { UnifiSensor } from "./sensor";
import { UnifiLight } from "./light";
import { UnifiLock } from "./lock";
import { sleep } from "@scrypted/common/src/sleep";
import axios from "axios";

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

export class UnifiProtect extends ScryptedDeviceBase implements Settings, DeviceProvider {
    authorization: string | undefined;
    accessKey: string | undefined;
    cameras = new Map<string, UnifiCamera>()
    sensors = new Map<string, UnifiSensor>();
    lights = new Map<string, UnifiLight>();
    locks = new Map<string, UnifiLock>();
    api: ProtectApi;
    startup: Promise<void>;
    runningEvents = new Map<string, { promise: Promise<unknown>, resolve: (value: unknown) => void }>();

    constructor(nativeId?: string) {
        super(nativeId);

        this.startup = this.discoverDevices(0)

        this.updateManagementUrl();
    }

    handleUpdatePacket(packet: any) {
        if (packet.action.action !== "update") {
            return;
        }
        if (!packet.action.id) {
            return;
        }

        const device = this.api.cameras?.find(c => c.id === packet.action.id)
            || this.api.lights?.find(c => c.id === packet.action.id)
            || this.api.doorlocks?.find(c => c.id === packet.action.id)
            || this.api.sensors?.find(c => c.id === packet.action.id);

        if (!device) {
            return;
        }

        Object.assign(device, packet.payload);

        const ret = this.sensors.get(packet.action.id) ||
            this.locks.get(packet.action.id) ||
            this.cameras.get(packet.action.id) ||
            this.lights.get(packet.action.id);

        const keys = new Set(Object.keys(packet.payload));
        for (const k of filter) {
            keys.delete(k);
        }
        if (keys.size > 0)
            ret?.console.log('update packet', packet.payload);
        return ret;
    }

    sanityCheckMotion(device: UnifiCamera | UnifiSensor | UnifiLight, payload: ProtectNvrUpdatePayloadCameraUpdate & LastSeenShim) {
        if (device.motionDetected && payload.lastSeen > payload.lastMotion + defaultSensorTimeout) {
            // something weird happened, lets set unset any motion state
            device.setMotionDetected(false);
        }
    }

    public async loginFetch(url: string, options?: { method?: string, signal?: AbortSignal, responseType?: axios.ResponseType }) {
        const api = this.api as any;
        if (!(await api.login()))
            throw new Error('Login failed.');

        const headers: Record<string, string> = {};
        for (const [header, value] of api.headers) {
            headers[header] = value;
        }

        return axios(url, {
            responseType: options?.responseType,
            method: options?.method,
            headers,
            httpsAgent: api.httpsAgent,
            signal: options?.signal,
        })
    }

    listener(event: Buffer) {
        const updatePacket = ProtectApiUpdates.decodeUpdatePacket(this.console, event);
        if (!updatePacket)
            return;

        // this.console.log('updatePacket', updatePacket);

        const unifiDevice = this.handleUpdatePacket(updatePacket);

        switch (updatePacket.action.modelKey) {
            case "sensor":
            case "doorlock":
            case "light":
            case "camera": {
                if (!unifiDevice) {
                    this.console.log('unknown device, sync needed?', updatePacket.action.id);
                    return;
                }
                if (updatePacket.action.action !== "update") {
                    unifiDevice.console.log('non update', updatePacket.action.action);
                    return;
                }
                unifiDevice.updateState();

                if (updatePacket.action.modelKey === "doorlock")
                    return;

                const payload = updatePacket.payload as any as ProtectNvrUpdatePayloadCameraUpdate & LastSeenShim;
                this.sanityCheckMotion(unifiDevice as any, payload);

                if (updatePacket.action.modelKey !== "camera")
                    return;

                const unifiCamera = unifiDevice as UnifiCamera;
                if (payload.lastRing && unifiCamera.binaryState && payload.lastSeen > payload.lastRing + unifiCamera.getSensorTimeout()) {
                    // something weird happened, lets set unset any binary sensor state
                    unifiCamera.binaryState = false;
                }

                unifiCamera.lastSeen = payload.lastSeen;
                break;
            }
            case "event": {
                if (updatePacket.action.action !== "add") {
                    if ((updatePacket?.payload as any)?.end && updatePacket.action.id) {
                        // unifi reports the event ended but it seems to take a moment before the snapshot
                        // is actually ready.
                        setTimeout(() => {
                            const running = this.runningEvents.get(updatePacket.action.id);
                            running?.resolve?.(undefined)
                        }, 2000);
                    }
                    return;
                }

                const payload = updatePacket.payload as ProtectNvrUpdatePayloadEventAdd;
                if (!payload.camera)
                    return;
                const unifiCamera = this.cameras.get(payload.camera);

                if (!unifiCamera) {
                    this.console.log('unknown device event, sync needed?', payload.camera);
                    return;
                }

                const detectionId = payload.id;
                const actionId = updatePacket.action.id;

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

                if (payload.type === 'smartDetectZone' || payload.type === 'smartDetectLine') {
                    unifiCamera.resetDetectionTimeout();

                    detections = payload.smartDetectTypes.map(type => ({
                        className: type,
                        score: payload.score,
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
                        unifiCamera.setMotionDetected(true);
                        unifiCamera.lastMotion = payload.start;
                        // i don't think this is necessary anymore?
                        // the event stream will set and unset motion.
                        unifiCamera.resetMotionTimeout();
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
        if (this.storage.getItem('debug'))
            this.console.log(message, ...parameters);
    }

    async discoverDevices(duration: number) {
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

        this.api?.eventsWs?.removeAllListeners();
        this.api?.eventsWs?.close();
        if (!this.api) {
            this.api = new ProtectApi(ip, username, password, {
                debug() { },
                error: (...args) => {
                    this.console.error(...args);
                },
                info() { },
                warn() { },
            });
        }

        let reconnecting = false;
        const reconnect = (reason: string) => {
            return async () => {
                if (reconnecting)
                    return;
                reconnecting = true;
                this.api?.eventsWs?.close();
                this.api?.eventsWs?.emit('close');
                this.api?.eventsWs?.removeAllListeners();
                if (this.api.eventsWs) {
                    this.console.warn('Event Listener failed to close. Requesting plugin restart.');
                    deviceManager.requestRestart();
                }
                this.console.error('Event Listener reconnecting in 10 seconds:', reason);
                await sleep(10000);
                this.discoverDevices(0);
            }
        }

        try {
            if (!await this.api.refreshDevices()) {
                reconnect('refresh failed')();
                return;
            }

            let wsTimeout: NodeJS.Timeout;
            const resetWsTimeout = () => {
                clearTimeout(wsTimeout);
                wsTimeout = setTimeout(reconnect('timeout'), 5 * 60 * 1000);
            };
            resetWsTimeout();

            this.api.eventsWs?.on('message', (data) => {
                resetWsTimeout();
                this.listener(data as Buffer);
            });
            this.api.eventsWs?.on('close', reconnect('close'));
            this.api.eventsWs?.on('error', reconnect('error'));

            const devices: Device[] = [];

            for (let camera of this.api.cameras || []) {
                if (camera.isAdoptedByOther) {
                    this.console.log('skipping camera that is adopted by another nvr', camera.id, camera.name);
                    continue;
                }

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
                    camera = await this.api.updateCameraChannels(camera);
                    if (!camera) {
                        this.log.a('Unable to enable RTSP and IDR interval on camera. Is this an admin account?');
                        continue;
                    }
                }

                const managementUrl = `https://${this.storage.getItem('ip')}/protect/timelapse/${camera.id}`;

                const isDoorbell = camera.featureFlags.isDoorbell || camera.featureFlags.hasChime;
                const d: Device = {
                    providerNativeId: this.nativeId,
                    name: camera.name,
                    nativeId: camera.id,
                    info: {
                        manufacturer: 'Ubiquiti',
                        model: camera.type,
                        firmware: camera.firmwareVersion,
                        version: camera.hardwareRevision,
                        serialNumber: camera.id,
                        mac: camera.mac,
                        managementUrl,
                    },
                    interfaces: [
                        ScryptedInterface.Settings,
                        ScryptedInterface.Camera,
                        ScryptedInterface.VideoCamera,
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
                if ((camera.featureFlags as any as FeatureFlagsShim).hasPackageCamera) {
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

            for (const sensor of this.api.sensors || []) {
                const d: Device = {
                    providerNativeId: this.nativeId,
                    name: sensor.name,
                    nativeId: sensor.id,
                    info: {
                        manufacturer: 'Ubiquiti',
                        model: sensor.type,
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

            for (const light of this.api.lights || []) {
                const d: Device = {
                    providerNativeId: this.nativeId,
                    name: light.name,
                    nativeId: light.id,
                    info: {
                        manufacturer: 'Ubiquiti',
                        model: light.type,
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

            for (const lock of this.api.doorlocks || []) {
                const d: Device = {
                    providerNativeId: this.nativeId,
                    name: lock.name,
                    nativeId: lock.id,
                    info: {
                        manufacturer: 'Ubiquiti',
                        model: lock.type,
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

            await deviceManager.onDevicesChanged({
                providerNativeId: this.nativeId,
                devices,
            });

            for (const device of devices) {
                this.getDevice(device.nativeId).then(device => device?.updateState());
            }

            // handle package cameras as a sub device
            for (const camera of this.api.cameras) {
                if (!(camera.featureFlags as any as FeatureFlagsShim).hasPackageCamera)
                    continue;
                const nativeId = camera.id + '-packageCamera';
                const d: Device = {
                    providerNativeId: camera.id,
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

                await deviceManager.onDevicesChanged({
                    providerNativeId: camera.id,
                    devices: [d],
                });
            }
        }
        catch (e) {
            this.log.a(`login error: ${e}`);
            this.console.error('login error', e);
        }
    }

    async releaseDevice(id: string, nativeId: string): Promise<void> {
    }

    async getDevice(nativeId: string): Promise<UnifiCamera | UnifiLight | UnifiSensor | UnifiLock> {
        await this.startup;
        if (this.cameras.has(nativeId))
            return this.cameras.get(nativeId);
        if (this.sensors.has(nativeId))
            return this.sensors.get(nativeId);
        if (this.lights.has(nativeId))
            return this.lights.get(nativeId);
        if (this.locks.has(nativeId))
            return this.locks.get(nativeId);
        const camera = this.api.cameras.find(camera => camera.id === nativeId);
        if (camera) {
            const ret = new UnifiCamera(this, nativeId, camera);
            this.cameras.set(nativeId, ret);
            return ret;
        }
        const sensor = this.api.sensors.find(sensor => sensor.id === nativeId);
        if (sensor) {
            const ret = new UnifiSensor(this, nativeId, sensor);
            this.sensors.set(nativeId, ret);
            return ret;
        }
        const light = this.api.lights.find(light => light.id === nativeId);
        if (light) {
            const ret = new UnifiLight(this, nativeId, light);
            this.lights.set(nativeId, ret);
            return ret;
        }
        const lock = this.api.doorlocks?.find(lock => lock.id === nativeId);
        if (lock) {
            const ret = new UnifiLock(this, nativeId, lock);
            this.locks.set(nativeId, ret);
            return ret;
        }
        throw new Error('device not found?');
    }

    getSetting(key: string): string {
        return this.storage.getItem(key);
    }

    async getSettings(): Promise<Setting[]> {
        const ret: Setting[] = [
            {
                key: 'username',
                title: 'Username',
                value: this.getSetting('username') || '',
            },
            {
                key: 'password',
                title: 'Password',
                type: 'password',
                value: this.getSetting('password') || '',
            },
            {
                key: 'ip',
                title: 'Unifi Protect IP',
                placeholder: '192.168.1.100',
                value: this.getSetting('ip') || '',
            },
        ];

        if (!isInstanceableProviderModeEnabled()) {
            ret.push({
                key: 'instance-mode',
                title: 'Multiple Unifi Protect Applications',
                value: '',
                description: 'To add more than one Unifi Protect application, you will need to migrate the plugin to multi-application mode. Type "MIGRATE" in the textbox to confirm.',
                placeholder: 'MIGRATE',
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

        this.storage.setItem(key, value.toString());
        this.discoverDevices(0);

        this.updateManagementUrl();
    }
}

export default createInstanceableProviderPlugin("Unifi Protect Application", nativeid => new UnifiProtect(nativeid));
