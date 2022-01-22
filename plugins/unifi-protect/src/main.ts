import sdk, { ScryptedDeviceBase, DeviceProvider, Settings, Setting, ScryptedDeviceType, VideoCamera, MediaObject, Device, MotionSensor, ScryptedInterface, Camera, MediaStreamOptions, Intercom, ScryptedMimeTypes, FFMpegInput, ObjectDetector, PictureOptions, ObjectDetectionTypes, ObjectsDetected, ObjectDetectionResult, Notifier, SCRYPTED_MEDIA_SCHEME, VideoCameraConfiguration, OnOff } from "@scrypted/sdk";
import { ProtectCameraChannelConfig, ProtectCameraConfigInterface, ProtectApi, ProtectCameraLcdMessagePayload, ProtectApiUpdates, ProtectNvrUpdatePayloadCameraUpdate, ProtectNvrUpdatePayloadEventAdd } from "@koush/unifi-protect";
import child_process, { ChildProcess } from 'child_process';
import { ffmpegLogInitialOutput } from '../../../common/src/media-helpers';
import { createInstanceableProviderPlugin, enableInstanceableProviderMode, isInstanceableProviderModeEnabled } from '../../../common/src/provider-plugin';
import { recommendRebroadcast } from "../../rtsp/src/recommend";
import { fitHeightToWidth } from "../../../common/src/resolution-utils";
import { listenZero } from "../../../common/src/listen-cluster";
import net from 'net';
import WS from 'ws';
import { once } from "events";

const { log, deviceManager, mediaManager } = sdk;

const defaultSensorTimeout = 30;

class UnifiPackageCamera extends ScryptedDeviceBase implements Camera, VideoCamera, MotionSensor {
    constructor(public camera: UnifiCamera, nativeId: string) {
        super(nativeId);
    }
    async takePicture(options?: PictureOptions): Promise<MediaObject> {
        const buffer = await this.camera.getSnapshot(options, 'package-snapshot?');
        return mediaManager.createMediaObject(buffer, 'image/jpeg');
    }
    async getPictureOptions(): Promise<PictureOptions[]> {
        return;
    }
    async getVideoStream(options?: MediaStreamOptions): Promise<MediaObject> {
        const o = (await this.getVideoStreamOptions())[0];
        return this.camera.getVideoStream(o);
    }
    async getVideoStreamOptions(): Promise<MediaStreamOptions[]> {
        const options = await this.camera.getVideoStreamOptions();
        return [options[options.length - 1]];
    }
}

class UnifiCamera extends ScryptedDeviceBase implements Notifier, Intercom, Camera, VideoCamera, VideoCameraConfiguration, MotionSensor, Settings, ObjectDetector, DeviceProvider, OnOff {
    protect: UnifiProtect;
    motionTimeout: NodeJS.Timeout;
    detectionTimeout: NodeJS.Timeout;
    ringTimeout: NodeJS.Timeout;
    lastMotion: number;
    lastRing: number;
    lastSeen: number;
    intercomProcess?: ChildProcess;
    packageCamera?: UnifiPackageCamera;

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

        this.updateState();
    }

    async setStatusLight(on: boolean) {
        const camera = this.findCamera() as any;
        await this.protect.api.updateCamera(camera, {
            ledSettings: {
                isEnabled: on,
            }
        });
    }

    async turnOn(): Promise<void> {
        this.setStatusLight(true);
    }

    async turnOff(): Promise<void> {
        this.setStatusLight(false);
    }

    ensurePackageCamera() {
        if (!this.packageCamera) {
            const nativeId = this.nativeId + '-packageCamera';
            this.packageCamera = new UnifiPackageCamera(this, nativeId);
        }
    }
    async getDevice(nativeId: string) {
        this.ensurePackageCamera();
        return this.packageCamera;
    }

    async startIntercom(media: MediaObject) {
        const buffer = await mediaManager.convertMediaObjectToBuffer(media, ScryptedMimeTypes.FFmpegInput);
        const ffmpegInput = JSON.parse(buffer.toString()) as FFMpegInput;

        const camera = this.findCamera();
        const params = new URLSearchParams({ camera: camera.id });
        const response = await this.protect.api.loginFetch(this.protect.api.wsUrl() + "/talkback?" + params.toString());
        const tb = await response.json() as Record<string, string>;

        // Adjust the URL for our address.
        const tbUrl = new URL(tb.url);
        tbUrl.hostname = this.protect.getSetting('ip');
        const talkbackUrl = tbUrl.toString();

        const websocket = new WS(talkbackUrl, { rejectUnauthorized: false });
        await once(websocket, 'open');

        const server = new net.Server(async (socket) => {
            server.close();

            this.console.log('sending audio data to', talkbackUrl);

            try {
                while (websocket.readyState === WS.OPEN) {
                    await once(socket, 'readable');
                    while (true) {
                        const data = socket.read();
                        if (!data)
                            break;
                        websocket.send(data, e => {
                            if (e)
                                socket.destroy();
                        });
                    }
                }
            }
            finally {
                this.console.log('talkback ended')
                this.intercomProcess.kill();
            }
        });
        const port = await listenZero(server)

        const args = ffmpegInput.inputArguments.slice();

        args.push(
            "-acodec", "libfdk_aac",
            "-profile:a", "aac_low",
            "-threads", "0",
            "-avioflags", "direct",
            "-max_delay", "3000000",
            "-flush_packets", "1",
            "-flags", "+global_header",
            "-ar", camera.talkbackSettings.samplingRate.toString(),
            "-ac", camera.talkbackSettings.channels.toString(),
            "-b:a", "16k",
            "-f", "adts",
            `tcp://127.0.0.1:${port}`,
        );

        this.console.log('starting 2 way audio', args);

        const ffmpeg = await mediaManager.getFFmpegPath();
        this.intercomProcess = child_process.spawn(ffmpeg, args);
        this.intercomProcess.on('exit', () => {
            websocket.close();
            this.intercomProcess = undefined;
        });
        ffmpegLogInitialOutput(this.console, this.intercomProcess);
    }

    async stopIntercom() {
        this.intercomProcess?.kill();
        this.intercomProcess = undefined;
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
            this.setMotionDetected(false);
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

    async getSnapshot(options?: PictureOptions, suffix?: string): Promise<Buffer> {
        suffix = suffix || 'snapshot';
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
        const url = `https://${this.protect.getSetting('ip')}/proxy/protect/api/cameras/${this.nativeId}/${suffix}?ts=${Date.now()}${size}`

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

    async setVideoStreamOptions(options: MediaStreamOptions): Promise<void> {
        const bitrate = options?.video?.bitrate;
        if (!bitrate)
            return;

        const camera = this.findCamera();
        const channel = camera.channels.find(channel => channel.id === options.id);

        const sanitizedBitrate = Math.min(channel.maxBitrate, Math.max(channel.minBitrate, bitrate));
        this.console.log('bitrate change requested', bitrate, 'clamped to', sanitizedBitrate);
        channel.bitrate = sanitizedBitrate;
        const cameraResult = await this.protect.api.updateChannels(camera);
        if (!cameraResult) {
            throw new Error("setVideoStreamOptions failed")
        }
    }

    async getPictureOptions(): Promise<PictureOptions[]> {
        return;
    }

    setMotionDetected(motionDetected: boolean) {
        this.motionDetected = motionDetected;
        if (this.findCamera().featureFlags.hasPackageCamera) {
            this.ensurePackageCamera();
            this.packageCamera.motionDetected = motionDetected;
        }
    }

    async sendNotification(title: string, body: string, media: string | MediaObject, mimeType?: string): Promise<void> {
        const payload: ProtectCameraLcdMessagePayload = {
            text: body.substring(0, 30),
            type: 'CUSTOM_MESSAGE',
        };
        this.protect.api.updateCamera(this.findCamera(), {
            lcdMessage: payload,
        })

        if (typeof media === 'string' && media.startsWith(SCRYPTED_MEDIA_SCHEME)) {
            media = await mediaManager.createMediaObjectFromUrl(media);
        }
        if (media) {
            if (typeof media === 'string') {
                media = await mediaManager.createMediaObjectFromUrl(media);
            }
            this.startIntercom(media);
        }
    }

    updateState() {
        const camera = this.findCamera();
        this.on = !!camera.ledSettings?.isEnabled;
    }
}

class UnifiProtect extends ScryptedDeviceBase implements Settings, DeviceProvider {
    authorization: string | undefined;
    accessKey: string | undefined;
    cameras: Map<string, UnifiCamera> = new Map();
    api: ProtectApi;
    startup: Promise<void>;
    runningEvents = new Map<string, { promise: Promise<unknown>, resolve: (value: unknown) => void }>();

    constructor(nativeId?: string, createOnly?: boolean) {
        super(nativeId);

        this.startup = this.discoverDevices(0)
        recommendRebroadcast();
    }

    listener = (event: Buffer) => {
        const updatePacket = ProtectApiUpdates.decodeUpdatePacket(this.console, event);
        this.api.handleUpdatePacket(updatePacket);

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

                rtsp.updateState();

                // rtsp.console.log('event camera', rtsp?.name, updatePacket.payload);

                const payload = updatePacket.payload as ProtectNvrUpdatePayloadCameraUpdate;

                // unifi protect will start events with isMotionDetected=true, and then send
                // subsequent updates to that motion event with lastMotion timestamp.
                // finally, it seems to set isMotionDetected=false, when the motion event ends.


                if (payload.isMotionDetected !== undefined) {
                    // explicitly set the motion state
                    rtsp.setMotionDetected(payload.isMotionDetected);
                    rtsp.lastMotion = payload.lastMotion;
                    rtsp.resetMotionTimeout();
                }
                else if (rtsp.lastMotion && payload.lastMotion && payload.lastMotion > rtsp.lastMotion) {
                    // motion is ongoing update
                    rtsp.setMotionDetected(true);
                    rtsp.lastMotion = payload.lastMotion;
                    rtsp.resetMotionTimeout();
                }
                else if (rtsp.motionDetected && payload.lastSeen > payload.lastMotion + rtsp.getSensorTimeout()) {
                    // something weird happened, lets set unset any motion state
                    rtsp.setMotionDetected(false);
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
                if (camera.featureFlags.hasPackageCamera) {
                    d.interfaces.push(ScryptedInterface.DeviceProvider);
                }
                if (camera.featureFlags.hasLedStatus) {
                    d.interfaces.push(ScryptedInterface.OnOff);
                }
                d.interfaces.push(ScryptedInterface.ObjectDetector);
                devices.push(d);
            }

            await deviceManager.onDevicesChanged({
                providerNativeId: this.nativeId,
                devices
            });

            for (const device of devices) {
                this.getDevice(device.nativeId);
            }

            // handle package cameras
            for (const camera of this.api.Cameras) {
                if (!camera.featureFlags.hasPackageCamera)
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

    async getDevice(nativeId: string): Promise<UnifiCamera> {
        await this.startup;
        if (this.cameras.has(nativeId))
            return this.cameras.get(nativeId);
        const camera = this.api.Cameras.find(camera => camera.id === nativeId);
        if (!camera)
            throw new Error('camera not found?');
        const ret = new UnifiCamera(this, nativeId, camera);
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
