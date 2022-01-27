import sdk, { ScryptedDeviceBase, DeviceProvider, Settings, Setting, ScryptedDeviceType, Device, ScryptedInterface, ObjectsDetected, ObjectDetectionResult } from "@scrypted/sdk";
import { ProtectApi, ProtectApiUpdates, ProtectNvrUpdatePayloadCameraUpdate, ProtectNvrUpdatePayloadEventAdd } from "@koush/unifi-protect";
import { createInstanceableProviderPlugin, enableInstanceableProviderMode, isInstanceableProviderModeEnabled } from '../../../common/src/provider-plugin';
import { recommendRebroadcast } from "../../rtsp/src/recommend";
import { RequestInfo, RequestInit, Response } from "node-fetch-cjs";
import { defaultSensorTimeout, UnifiCamera } from "./camera";
import { FeatureFlagsShim, LastSeenShim } from "./shim";
import { UnifiSensor } from "./sensor";
import { UnifiLight } from "./light";
import { UnifiLock } from "./lock";

const { deviceManager } = sdk;

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
        recommendRebroadcast();
    }

    handleUpdatePacket(packet: any): void {
        if (packet.action?.modelKey !== "camera") {
            return;
        }
        if (packet.action.action !== "update") {
            return;
        }
        if (!packet.action.id) {
            return;
        }

        const device = this.api.cameras?.find(c => c.id === packet.action.id)
            || this.api.lights?.find(c => c.id === packet.action.id)
            || this.api.sensors?.find(c => c.id === packet.action.id);

        if (!device) {
            return;
        }

        Object.assign(device, packet.payload);
    }

    sanityCheckMotion(device: UnifiCamera | UnifiSensor | UnifiLight, payload: ProtectNvrUpdatePayloadCameraUpdate & LastSeenShim) {
        if (device.motionDetected && payload.lastSeen > payload.lastMotion + defaultSensorTimeout) {
            // something weird happened, lets set unset any motion state
            device.setMotionDetected(false);
        }
    }

    public async loginFetch(url: RequestInfo, options: RequestInit = { method: "GET" }, logErrors = true, decodeResponse = true): Promise<Response | null> {
        const api = this.api as any;
        if (!(await api.login())) {
            return null;
        }

        return this.api.fetch(url, options, logErrors, decodeResponse);
    }

    listener = (event: Buffer) => {
        const updatePacket = ProtectApiUpdates.decodeUpdatePacket(this.console, event);
        this.handleUpdatePacket(updatePacket);

        if (!updatePacket) {
            this.console.error("%s: Unable to process message from the realtime update events API.", this.api.getNvrName());
            return;
        }

        switch (updatePacket.action.modelKey) {
            case "sensor": {
                const unifiSensor = this.sensors.get(updatePacket.action.id);
                if (!unifiSensor) {
                    return;
                }
                if (updatePacket.action.action !== "update") {
                    unifiSensor.console.log('non update', updatePacket.action.action);
                    return;
                }

                unifiSensor.updateState();

                const payload = updatePacket.payload as any as ProtectNvrUpdatePayloadCameraUpdate & LastSeenShim;
                this.sanityCheckMotion(unifiSensor, payload);
                break;
            }
            case "doorlock": {
                const unifiDoorlock = this.locks.get(updatePacket.action.id);
                if (!unifiDoorlock) {
                    return;
                }
                if (updatePacket.action.action !== "update") {
                    unifiDoorlock.console.log('non update', updatePacket.action.action);
                    return;
                }

                unifiDoorlock.updateState();
                break;
            }
            case "light": {
                const unifiLight = this.lights.get(updatePacket.action.id);
                if (!unifiLight) {
                    return;
                }
                if (updatePacket.action.action !== "update") {
                    unifiLight.console.log('non update', updatePacket.action.action);
                    return;
                }

                unifiLight.updateState();

                const payload = updatePacket.payload as any as ProtectNvrUpdatePayloadCameraUpdate & LastSeenShim;
                this.sanityCheckMotion(unifiLight, payload);
                break;
            }
            case "camera": {
                const unifiCamera = this.cameras.get(updatePacket.action.id);

                // We don't know about this camera - we're done.
                if (!unifiCamera) {
                    // this.console.log('unknown camera', updatePacket.action.id);
                    return;
                }

                if (updatePacket.action.action !== "update") {
                    unifiCamera.console.log('non update', updatePacket.action.action);
                    return;
                }

                unifiCamera.updateState();

                // unifiCamera.console.log('update', updatePacket.payload);

                const payload = updatePacket.payload as any as ProtectNvrUpdatePayloadCameraUpdate & LastSeenShim;
                this.sanityCheckMotion(unifiCamera, payload);

                if (unifiCamera.motionDetected && payload.lastSeen > payload.lastMotion + unifiCamera.getSensorTimeout()) {
                    // something weird happened, lets set unset any motion state
                    unifiCamera.setMotionDetected(false);
                }

                if (payload.lastRing && unifiCamera.binaryState && payload.lastSeen > payload.lastRing + unifiCamera.getSensorTimeout()) {
                    // something weird happened, lets set unset any binary sensor state
                    unifiCamera.binaryState = false;
                }

                unifiCamera.lastSeen = payload.lastSeen;
                break;
            }
            case "event": {
                // We're only interested in add events.
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

                // Grab the right payload type, for event add payloads.
                const payload = updatePacket.payload as ProtectNvrUpdatePayloadEventAdd;

                // Lookup the accessory associated with this camera.
                const rtsp = this.cameras.get(payload.camera);

                // We don't know about this camera - we're done.
                if (!rtsp) {
                    // this.console.log('unknown camera', payload.camera);
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


                rtsp.console.log('event', payload);

                let detections: ObjectDetectionResult[] = [];

                if (payload.type === 'smartDetectZone') {
                    rtsp.resetDetectionTimeout();

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
                        rtsp.binaryState = true;
                        rtsp.lastRing = payload.start;
                        rtsp.resetRingTimeout();
                    }
                    else if (payload.type === 'motion') {
                        rtsp.setMotionDetected(true);
                        rtsp.lastMotion = payload.start;
                        rtsp.resetMotionTimeout();
                    }
                }

                const detection: ObjectsDetected = {
                    detectionId,
                    // eventId indicates that the detection is within a single frame.
                    eventId: detectionId,
                    timestamp: Date.now(),
                    detections,
                };
                rtsp.onDeviceEvent(ScryptedInterface.ObjectDetector, detection);

                rtsp.lastSeen = payload.start;
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

        if (!this.api) {
            this.api = new ProtectApi(ip, username, password, this.console);
        }

        try {
            this.api.eventListener?.removeListener('message', this.listener);
            if (!await this.api.refreshDevices()) {
                this.console.log('refresh failed, trying again in 10 seconds.');
                setTimeout(() => {
                    this.discoverDevices(0);
                }, 10000);
                return;
            }
            this.api.eventListener?.on('message', this.listener);
            this.api.eventListener?.on('close', async () => {
                this.console.error('Event Listener closed. Reconnecting in 10 seconds.');
                await new Promise(resolve => setTimeout(resolve, 10000));
                this.discoverDevices(0);
            })

            const devices: Device[] = [];

            if (!this.api.cameras) {
                this.console.error('Cameras failed to load. Retrying in 10 seconds.');
                setTimeout(() => {
                    this.discoverDevices(0);
                }, 10000);
                return;
            }

            for (let camera of this.api.cameras) {
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
                    },
                    interfaces: [
                        ScryptedInterface.Settings,
                        ScryptedInterface.Camera,
                        ScryptedInterface.VideoCamera,
                        ScryptedInterface.VideoCameraConfiguration,
                        ScryptedInterface.MotionSensor,
                    ],
                    type: camera.featureFlags.hasChime
                        ? ScryptedDeviceType.Doorbell
                        : ScryptedDeviceType.Camera,
                };
                if (camera.featureFlags.hasChime) {
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
                d.interfaces.push(ScryptedInterface.ObjectDetector);
                devices.push(d);
            }

            for (const sensor of this.api.sensors) {
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
        const lock = this.api.doorlocks.find(lock => lock.id === nativeId);
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
    async putSetting(key: string, value: string | number) {
        if (key === 'instance-mode') {
            if (value === 'MIGRATE') {
                await enableInstanceableProviderMode();
            }
            return;
        }
        this.storage.setItem(key, value.toString());
        this.discoverDevices(0);
    }
}

export default createInstanceableProviderPlugin("Unifi Protect Application", nativeid => new UnifiProtect(nativeid));
