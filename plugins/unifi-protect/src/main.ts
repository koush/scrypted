import sdk, { ScryptedDeviceBase, DeviceProvider, Settings, Setting, ScryptedDeviceType, VideoCamera, MediaObject, Device, MotionSensor, ScryptedInterface, Camera, MediaStreamOptions, Intercom, ScryptedMimeTypes, FFMpegInput, ObjectDetector, PictureOptions, ObjectDetectionTypes, ObjectsDetected, ObjectDetectionResult } from "@scrypted/sdk";
import { ProtectApi } from "@koush/unifi-protect";
import { ProtectApiUpdates, ProtectNvrUpdatePayloadCameraUpdate, ProtectNvrUpdatePayloadEventAdd } from "@koush/unifi-protect";
import { ProtectCameraChannelConfig, ProtectCameraConfigInterface } from "@koush/unifi-protect";
import child_process, { ChildProcess } from 'child_process';
import { ffmpegLogInitialOutput } from '../../../common/src/media-helpers';
import { createInstanceableProviderPlugin, enableInstanceableProviderMode, isInstanceableProviderModeEnabled } from '../../../common/src/provider-plugin';
import { recommendRebroadcast } from "../../rtsp/src/recommend";
import { fitHeightToWidth } from "../../../common/src/resolution-utils";

const { log, deviceManager, mediaManager } = sdk;

const defaultSensorTimeout = 30;

class UnifiCamera extends ScryptedDeviceBase implements Camera, VideoCamera, MotionSensor, Settings, ObjectDetector {
    protect: UnifiProtect;
    motionTimeout: NodeJS.Timeout;
    detectionTimeout: NodeJS.Timeout;
    ringTimeout: NodeJS.Timeout;
    lastMotion: number;
    lastRing: number;
    lastSeen: number;

    constructor(protect: UnifiProtect, nativeId: string, protectCamera: Readonly<ProtectCameraConfigInterface>) {
        super(nativeId);
        this.protect = protect;
        this.lastMotion = protectCamera?.lastMotion;
        this.lastRing = protectCamera?.lastRing;
        this.lastSeen = protectCamera?.lastSeen;

        this.motionDetected = false;
        if (this.interfaces.includes(ScryptedInterface.BinarySensor)) {
            this.binaryState = false;
        }
    }

    async getObjectTypes(): Promise<ObjectDetectionTypes> {
        const classes = ['motion'];
        if (this.interfaces.includes(ScryptedInterface.BinarySensor))
            classes.push('ring');
        if (this.interfaces.includes(ScryptedInterface.ObjectDetector))
            classes.push(...this.findCamera().featureFlags.smartDetectTypes);
        return {
            classes,
        };
    }

    async getDetectionInput(detectionId: any): Promise<MediaObject> {
        const input = this.protect.runningEvents.get(detectionId);
        if (input) {
            this.console.log('fetching event snapshot', detectionId);
            await input.promise;
        }
        const url = `https://${this.protect.getSetting('ip')}/proxy/protect/api/events/${detectionId}/thumbnail`;
        const response = await this.protect.api.loginFetch(url);
        if (!response) {
            throw new Error('Unifi Protect login refresh failed.');
        }
        const data = await response.arrayBuffer();
        return mediaManager.createMediaObject(Buffer.from(data), 'image/jpeg');
    }

    getDefaultOrderedVideoStreamOptions(vsos: MediaStreamOptions[]) {
        if (!vsos || !vsos.length)
            return vsos;
        const defaultStream = this.getDefaultStream(vsos);
        if (!defaultStream)
            return vsos;
        vsos = vsos.filter(vso => vso.id !== defaultStream?.id);
        vsos.unshift(defaultStream);
        return vsos;
    }

    getDefaultStream(vsos: MediaStreamOptions[]) {
        let defaultStreamIndex = vsos.findIndex(vso => vso.id === this.storage.getItem('defaultStream'));
        if (defaultStreamIndex === -1)
            defaultStreamIndex = 0;

        return vsos[defaultStreamIndex];
    }

    async getSettings(): Promise<Setting[]> {
        const vsos = await this.getVideoStreamOptions();
        const defaultStream = this.getDefaultStream(vsos);
        return [
            {
                title: 'Default Stream',
                key: 'defaultStream',
                value: defaultStream?.name,
                choices: vsos.map(vso => vso.name),
                description: 'The default stream to use when not specified',
            },
            {
                title: 'Sensor Timeout',
                key: 'sensorTimeout',
                value: this.storage.getItem('sensorTimeout') || defaultSensorTimeout,
                description: 'Time to wait in seconds before clearing the motion, doorbell button, or object detection state.',
            }
        ];
    }

    async putSetting(key: string, value: string | number | boolean) {
        if (key === 'defaultStream') {
            const vsos = await this.getVideoStreamOptions();
            const stream = vsos.find(vso => vso.name === value);
            this.storage.setItem('defaultStream', stream?.id);
        }
        else {
            this.storage.setItem(key, value?.toString());
        }
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);
    }

    getSensorTimeout() {
        return (parseInt(this.storage.getItem('sensorTimeout')) || 10) * 1000;
    }

    resetMotionTimeout() {
        clearTimeout(this.motionTimeout);
        this.motionTimeout = setTimeout(() => {
            this.motionDetected = false;
        }, this.getSensorTimeout());
    }

    resetDetectionTimeout() {
        clearTimeout(this.detectionTimeout);
        this.detectionTimeout = setTimeout(() => {
            const detect: ObjectsDetected = {
                timestamp: Date.now(),
                detections: []
            }
            this.onDeviceEvent(ScryptedInterface.ObjectDetector, detect);
        }, this.getSensorTimeout());
    }

    resetRingTimeout() {
        clearTimeout(this.ringTimeout);
        this.ringTimeout = setTimeout(() => {
            this.binaryState = false;
        }, this.getSensorTimeout());
    }

    async getSnapshot(options?: PictureOptions): Promise<Buffer> {
        let size = '';
        try {
            if (options?.picture?.width && options?.picture?.height) {
                const camera = this.findCamera();
                const mainChannel = camera.channels[0];
                const w = options.picture.width;
                const h = fitHeightToWidth(mainChannel.width, mainChannel.height, w);

                size = `&w=${w}&h=${h}`;
            }
        }
        catch (e) {

        }
        const url = `https://${this.protect.getSetting('ip')}/proxy/protect/api/cameras/${this.nativeId}/snapshot?ts=${Date.now()}${size}`

        const response = await this.protect.api.loginFetch(url);
        if (!response) {
            throw new Error('Unifi Protect login refresh failed.');
        }
        const data = await response.arrayBuffer();
        return Buffer.from(data);
    }

    async takePicture(options?: PictureOptions): Promise<MediaObject> {
        const buffer = await this.getSnapshot(options);
        return mediaManager.createMediaObject(buffer, 'image/jpeg');
    }
    findCamera() {
        return this.protect.api.Cameras.find(camera => camera.id === this.nativeId);
    }
    async getVideoStream(options?: MediaStreamOptions): Promise<MediaObject> {
        const camera = this.findCamera();
        const vsos = await this.getVideoStreamOptions();
        const vso = vsos.find(check => check.id === options?.id) || this.getDefaultStream(vsos);

        const rtspChannel = camera.channels.find(check => check.id === vso.id);

        const { rtspAlias } = rtspChannel;
        const u = `rtsp://${this.protect.getSetting('ip')}:7447/${rtspAlias}`

        return mediaManager.createFFmpegMediaObject({
            url: u,
            inputArguments: [
                "-rtsp_transport",
                "tcp",
                '-analyzeduration', '15000000',
                '-probesize', '100000000',
                "-reorder_queue_size",
                "1024",
                "-max_delay",
                "20000000",
                "-i",
                u,
            ],
            mediaStreamOptions: this.createMediaStreamOptions(rtspChannel),
        });
    }

    createMediaStreamOptions(channel: ProtectCameraChannelConfig) {
        const ret: MediaStreamOptions = {
            id: channel.id,
            name: channel.name,
            video: {
                codec: 'h264',
                width: channel.width,
                height: channel.height,
                bitrate: channel.maxBitrate,
                minBitrate: channel.minBitrate,
                maxBitrate: channel.maxBitrate,
                fps: channel.fps,
                idrIntervalMillis: channel.idrInterval * 1000,
            },
            audio: {
                codec: 'aac',
            },
        };
        return ret;
    }

    async getVideoStreamOptions(): Promise<MediaStreamOptions[]> {
        const camera = this.findCamera();
        const video: MediaStreamOptions[] = camera.channels
            .map(channel => this.createMediaStreamOptions(channel));

        return this.getDefaultOrderedVideoStreamOptions(video);
    }

    async getPictureOptions(): Promise<PictureOptions[]> {
        return;
    }
}

class UnifiDoorbell extends UnifiCamera implements Intercom {
    cp?: ChildProcess;

    async startIntercom(media: MediaObject) {
        const buffer = await mediaManager.convertMediaObjectToBuffer(media, ScryptedMimeTypes.FFmpegInput);
        const ffmpegInput = JSON.parse(buffer.toString()) as FFMpegInput;

        const args = ffmpegInput.inputArguments.slice();

        const camera = this.findCamera();

        args.push(
            "-acodec", camera.talkbackSettings.typeFmt,
            "-flags", "+global_header",
            "-ar", camera.talkbackSettings.samplingRate.toString(),
            "-b:a", "64k",
            "-f", "adts",
            "udp://" + camera.host + ":" + camera.talkbackSettings.bindPort,
        )

        const ffmpeg = await mediaManager.getFFmpegPath();
        this.cp = child_process.spawn(ffmpeg, args);
        this.cp.on('killed', () => this.cp = undefined);
        ffmpegLogInitialOutput(this.console, this.cp);
    }

    async stopIntercom() {
        this.cp?.kill();
        this.cp = undefined;
    }
}

class UnifiProtect extends ScryptedDeviceBase implements Settings, DeviceProvider {
    authorization: string | undefined;
    accessKey: string | undefined;
    cameras: Map<string, UnifiCamera> = new Map();
    api: ProtectApi;
    startup: Promise<void>;
    runningEvents = new Map<string, {promise: Promise<unknown>, resolve: (value: unknown) => void}>();

    constructor(nativeId?: string, createOnly?: boolean) {
        super(nativeId);

        this.startup = this.discoverDevices(0)
        recommendRebroadcast();
    }

    listener = (event: Buffer) => {
        const updatePacket = ProtectApiUpdates.decodeUpdatePacket(this.console, event);

        if (!updatePacket) {
            this.console.error("%s: Unable to process message from the realtime update events API.", this.api.getNvrName());
            return;
        }

        switch (updatePacket.action.modelKey) {
            case "camera": {
                const rtsp = this.cameras.get(updatePacket.action.id);

                // We don't know about this camera - we're done.
                if (!rtsp) {
                    // this.console.log('unknown camera', updatePacket.action.id);
                    return;
                }

                if (updatePacket.action.action !== "update") {
                    rtsp.console.log('non update', updatePacket.action.action);
                    return;
                }

                // rtsp.console.log('event camera', rtsp?.name, updatePacket.payload);

                const payload = updatePacket.payload as ProtectNvrUpdatePayloadCameraUpdate;

                // unifi protect will start events with isMotionDetected=true, and then send
                // subsequent updates to that motion event with lastMotion timestamp.
                // finally, it seems to set isMotionDetected=false, when the motion event ends.


                if (payload.isMotionDetected !== undefined) {
                    // explicitly set the motion state
                    rtsp.motionDetected = payload.isMotionDetected;
                    rtsp.lastMotion = payload.lastMotion;
                    rtsp.resetMotionTimeout();
                }
                else if (rtsp.lastMotion && payload.lastMotion && payload.lastMotion > rtsp.lastMotion) {
                    // motion is ongoing update
                    rtsp.motionDetected = true;
                    rtsp.lastMotion = payload.lastMotion;
                    rtsp.resetMotionTimeout();
                }
                else if (rtsp.motionDetected && payload.lastSeen > payload.lastMotion + rtsp.getSensorTimeout()) {
                    // something weird happened, lets set unset any motion state
                    rtsp.motionDetected = false;
                }

                if (payload.lastRing && rtsp.binaryState && payload.lastSeen > payload.lastRing + rtsp.getSensorTimeout()) {
                    // something weird happened, lets set unset any binary sensor state
                    rtsp.binaryState = false;
                }

                rtsp.lastSeen = payload.lastSeen;
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

                // Lookup the accessory associated with this camera.
                const rtsp = this.cameras.get(payload.camera);

                // We don't know about this camera - we're done.
                if (!rtsp) {
                    // this.console.log('unknown camera', payload.camera);
                    return;
                }

                rtsp.console.log('Camera Event', payload);

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
                        rtsp.motionDetected = true;
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
            this.api = new ProtectApi((message, ...parameters) =>
                this.debugLog(message, ...parameters), this.console, ip, username, password);
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

            if (!this.api.Cameras) {
                this.console.error('Cameras failed to load. Retrying in 10 seconds.');
                setTimeout(() => {
                    this.discoverDevices(0);
                }, 10000);
                return;
            }

            for (let camera of this.api.Cameras) {
                if (camera.isAdoptedByOther) {
                    this.console.log('skipping camera that is adopted by another nvr', camera.id, camera.name);
                    continue;
                }

                let needUpdate = false;
                for (const channel of camera.channels) {
                    if (channel.idrInterval !== 4 || !channel.isRtspEnabled) {
                        channel.idrInterval = 4;
                        channel.isRtspEnabled = true;
                        needUpdate = true;
                    }
                }

                if (needUpdate) {
                    camera = await this.api.updateChannels(camera);
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
                d.interfaces.push(ScryptedInterface.ObjectDetector);
                devices.push(d);
            }

            for (const d of devices) {
                await deviceManager.onDeviceDiscovered(d);
            }

            // todo: this was done, october 31st. remove sometime later.
            // todo: uncomment after implementing per providerNativeId onDevicesChanged.
            // await deviceManager.onDevicesChanged({
            //     providerNativeId: this.nativeId,
            //     devices
            // });

            for (const device of devices) {
                this.getDevice(device.nativeId);
            }
        }
        catch (e) {
            this.log.a(`login error: ${e}`);
            this.console.error('login error', e);
        }
    }

    async getDevice(nativeId: string): Promise<any> {
        await this.startup;
        if (this.cameras.has(nativeId))
            return this.cameras.get(nativeId);
        const camera = this.api.Cameras.find(camera => camera.id === nativeId);
        if (!camera)
            throw new Error('camera not found?');
        const ret = camera.featureFlags.hasSpeaker ?
            new UnifiDoorbell(this, nativeId, camera)
            : new UnifiCamera(this, nativeId, camera);
        this.cameras.set(nativeId, ret);
        return ret;
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
