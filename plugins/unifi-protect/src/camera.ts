import { ffmpegLogInitialOutput, safeKillFFmpeg } from '@scrypted/common/src/media-helpers';
import { readLength } from '@scrypted/common/src/read-stream';
import { fitHeightToWidth } from "@scrypted/common/src/resolution-utils";
import sdk, { BinarySensor, Camera, DeviceProvider, FFmpegInput, Intercom, MediaObject, MediaStreamConfiguration, MediaStreamOptions, MediaStreamUrl, MotionSensor, Notifier, NotifierOptions, ObjectDetectionTypes, ObjectDetector, ObjectsDetected, OnOff, Online, PanTiltZoom, PanTiltZoomCommand, PictureOptions, PrivacyMasks, ResponseMediaStreamOptions, ResponsePictureOptions, ScryptedDeviceBase, ScryptedInterface, ScryptedMimeTypes, Setting, Settings, VideoCamera, VideoCameraConfiguration, VideoCameraMask } from "@scrypted/sdk";
import child_process, { ChildProcess } from 'child_process';
import { once } from "events";
import { Readable } from "stream";
import WS from 'ws';
import { UnifiProtect } from "./main";
import { MOTION_SENSOR_TIMEOUT, UnifiFingerprintDevice, UnifiMotionDevice, debounceMotionDetected } from './camera-sensors';
import { FeatureFlagsShim, PrivacyZone } from "./shim";
import { ProtectCameraChannelConfig, ProtectCameraConfigInterface, ProtectCameraLcdMessagePayload } from "./unifi-protect";

const { deviceManager, mediaManager } = sdk;

export const defaultSensorTimeout = 30;

export class UnifiPackageCamera extends ScryptedDeviceBase implements Camera, VideoCamera, MotionSensor {
    constructor(public protectCamera: UnifiCamera, nativeId: string) {
        super(nativeId);
    }
    async takePicture(options?: PictureOptions): Promise<MediaObject> {
        const buffer = await this.protectCamera.getSnapshot(options, 'package-snapshot?');
        return this.createMediaObject(buffer, 'image/jpeg');
    }
    async getPictureOptions(): Promise<ResponsePictureOptions[]> {
        return [
            {
                canResize: true,
            }
        ];
    }
    async getVideoStream(options?: MediaStreamOptions): Promise<MediaObject> {
        const o = (await this.getVideoStreamOptions())[0];
        return this.protectCamera.getVideoStream(o);
    }
    async getVideoStreamOptions(): Promise<ResponseMediaStreamOptions[]> {
        const options = await this.protectCamera.getVideoStreamOptions();
        return [options[options.length - 1]];
    }
}
export class UnifiFingerprintSensor extends ScryptedDeviceBase implements BinarySensor {
    constructor(public protectCamera: UnifiCamera, nativeId: string) {
        super(nativeId);
    }
}

export class UnifiCamera extends ScryptedDeviceBase implements Notifier, Intercom, Camera, VideoCamera, VideoCameraConfiguration, MotionSensor, Settings, ObjectDetector, DeviceProvider, OnOff, PanTiltZoom, Online, UnifiMotionDevice, VideoCameraMask, UnifiFingerprintDevice {
    motionTimeout: NodeJS.Timeout;
    detectionTimeout: NodeJS.Timeout;
    ringTimeout: NodeJS.Timeout;
    lastRing: number;
    lastSeen: number;
    intercomProcess?: ChildProcess;
    packageCamera?: UnifiPackageCamera;
    fingerprintSensor?: UnifiFingerprintSensor;
    fingerprintTimeout: NodeJS.Timeout;

    constructor(public protect: UnifiProtect, nativeId: string, protectCamera: Readonly<ProtectCameraConfigInterface>) {
        super(nativeId);
        this.lastRing = protectCamera?.lastRing;
        this.lastSeen = protectCamera?.lastSeen;

        if (this.interfaces.includes(ScryptedInterface.BinarySensor)) {
            this.binaryState = false;
        }

        this.updateState(protectCamera);
        this.console.log(protectCamera);
    }

    async getPrivacyMasks(): Promise<PrivacyMasks> {
        const camera = this.findCamera();
        const privacyZones = (camera as any).privacyZones as PrivacyZone[] || [];

        const masks: PrivacyMasks = {
            masks: privacyZones.map(zone => {
                return {
                    id: zone.id.toString(),
                    name: zone.name,
                    points: zone.points,
                }
            }),
        };

        return masks;
    }

    async setPrivacyMasks(masks: PrivacyMasks): Promise<void> {
        const privacyZones: PrivacyZone[] = masks.masks.map((mask, index) => {
            return {
                id: index,
                name: mask.name || `Privacy Zone ${index}`,
                points: mask.points,
                color: 'red',
            }
        });

        const camera = this.findCamera() as any;

        await this.protect.api.updateCamera(camera, {
            privacyZones,
        } as any);
    }

    async ptzCommand(command: PanTiltZoomCommand): Promise<void> {
        const camera = this.findCamera() as any;
        await this.protect.api.updateCamera(camera, {
            ispSettings: {
                zoomPosition: Math.abs(command.zoom * 100),
            }
        });
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

    get packageCameraNativeId() {
        return this.nativeId + '-packageCamera';
    }

    get fingerprintSensorNativeId() {
        return this.nativeId + '-fingerprintSensor';
    }

    ensurePackageCamera() {
        if (!this.packageCamera) {
            this.packageCamera = new UnifiPackageCamera(this, this.packageCameraNativeId);
        }
    }

    ensureFingerprintSensor() {
        if (!this.fingerprintSensor) {
            this.fingerprintSensor = new UnifiFingerprintSensor(this, this.fingerprintSensorNativeId);
        }
    }

    async getDevice(nativeId: string) {
        if (nativeId === this.packageCameraNativeId) {
            this.ensurePackageCamera();
            return this.packageCamera;
        }
        if (nativeId === this.fingerprintSensorNativeId) {
            this.ensureFingerprintSensor();
            return this.fingerprintSensor;
        }
    }

    async releaseDevice(id: string, nativeId: string): Promise<void> {
    }

    async startIntercom(media: MediaObject) {
        this.stopIntercom();

        const buffer = await mediaManager.convertMediaObjectToBuffer(media, ScryptedMimeTypes.FFmpegInput);
        const ffmpegInput = JSON.parse(buffer.toString()) as FFmpegInput;

        const camera = this.findCamera();
        const params = new URLSearchParams({ camera: camera.id });
        const response = await this.protect.loginFetch(this.protect.api.wsUrl() + "/talkback?" + params.toString());
        const tb = response.data as Record<string, string>;

        // Adjust the URL for our address.
        const tbUrl = new URL(tb.url);
        tbUrl.hostname = this.protect.getSetting('ip');
        const talkbackUrl = tbUrl.toString();

        const websocket = new WS(talkbackUrl, { rejectUnauthorized: false });
        await once(websocket, 'open');

        const args = [
            '-hide_banner',

            '-fflags', 'nobuffer',
            '-flags', 'low_delay',

            ...ffmpegInput.inputArguments,
        ];

        args.push(
            "-acodec", "aac",
            "-profile:a", "aac_low",
            // "-threads", "0",
            "-avioflags", "direct",
            '-fflags', '+flush_packets', '-flush_packets', '1',
            "-flags", "+global_header",
            "-ar", camera.talkbackSettings.samplingRate.toString(),
            "-ac", camera.talkbackSettings.channels.toString(),
            "-b:a", "64k",
            "-f", "adts",
            "-muxdelay", "0",
            `pipe:3`,
        );

        this.console.log('starting 2 way audio', args);

        const ffmpeg = await mediaManager.getFFmpegPath();
        const cp = this.intercomProcess = child_process.spawn(ffmpeg, args, {
            stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
        });
        this.intercomProcess.on('exit', () => {
            this.intercomProcess = undefined;
            websocket.close();
        });

        websocket.on('close', () => safeKillFFmpeg(cp));

        (async () => {
            const socket = cp.stdio[3] as Readable;
            this.console.log('sending audio data to', talkbackUrl);

            try {
                while (websocket.readyState === WS.OPEN) {
                    // this parses out full adts packets to ensure there's no truncation on ws message boundary, but
                    // does not seem to matter.
                    // preferring this as it seems to be the "right" thing to do.
                    if (true) {
                        const buffers: Buffer[] = [];
                        do {
                            const header = await readLength(socket, 7);
                            const frameLength = ((header[3] & 0x03) << 11) | (header[4] << 3) | ((header[5] & 0xE0) >> 5);
                            const need = frameLength - 7;
                            const data = await readLength(socket, need);
                            buffers.push(header, data);
                        }
                        while (socket.readableLength > 7 && buffers.length < 10);
                        websocket.send(Buffer.concat(buffers));
                    }
                    else {
                        await once(socket, 'readable');
                        while (true) {
                            const data = socket.read();
                            if (!data)
                                break;
                            websocket.send(data, e => {
                                if (e) {
                                    safeKillFFmpeg(cp);
                                }
                            });
                        }
                    }
                }
            }
            finally {
                this.console.log('talkback ended')
                safeKillFFmpeg(cp);
            }
        })();


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
        if ((this.findCamera().featureFlags as any as FeatureFlagsShim).hasFingerprintSensor)
            classes.push('fingerprintIdentified');
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

        const abort = new AbortController();
        const timeout = setTimeout(() => abort.abort('Unifi Protect Snapshot timed out after 10 seconds. Aborted.'), 10000);
        const response = await this.protect.loginFetch(url, {
            signal: abort.signal,
            responseType: 'arraybuffer',
        });
        clearTimeout(timeout);
        if (!response)
            throw new Error('event snapshot unavailable.');
        const data = Buffer.from(response.data);
        return this.createMediaObject(Buffer.from(data), 'image/jpeg');
    }

    async getSettings(): Promise<Setting[]> {
        // const vsos = await this.getVideoStreamOptions();
        return [
            // {
            //     title: 'Sensor Timeout',
            //     key: 'sensorTimeout',
            //     value: this.storage.getItem('sensorTimeout') || defaultSensorTimeout,
            //     description: 'Time to wait in seconds before clearing the motion, doorbell button, or object detection state.',
            // }
        ];
    }

    async putSetting(key: string, value: string | number | boolean) {
        this.storage.setItem(key, value?.toString() || '');
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);
    }

    resetDetectionTimeout() {
        clearTimeout(this.detectionTimeout);
        this.detectionTimeout = setTimeout(() => {
            const detect: ObjectsDetected = {
                timestamp: Date.now(),
                detections: []
            }
            this.onDeviceEvent(ScryptedInterface.ObjectDetector, detect);
        }, MOTION_SENSOR_TIMEOUT);
    }

    resetRingTimeout() {
        clearTimeout(this.ringTimeout);
        this.ringTimeout = setTimeout(() => {
            this.binaryState = false;
        }, MOTION_SENSOR_TIMEOUT);
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
        const url = `https://${this.protect.getSetting('ip')}/proxy/protect/api/cameras/${this.findCamera().id}/${suffix}?ts=${Date.now()}${size}`

        const abort = new AbortController();
        const timeout = setTimeout(() => abort.abort('Unifi Protect Snapshot timed out after 10 seconds. Aborted.'), 10000);
        const response = await this.protect.loginFetch(url, {
            signal: abort.signal,
            responseType: 'arraybuffer',
        });
        clearTimeout(timeout);
        if (!response)
            throw new Error('login failed');
        const data = Buffer.from(response.data);
        return Buffer.from(data);
    }

    async takePicture(options?: PictureOptions): Promise<MediaObject> {
        const buffer = await this.getSnapshot(options);
        return this.createMediaObject(buffer, 'image/jpeg');
    }
    findCamera() {
        const id = this.protect.findId(this.nativeId);
        return this.protect.api.cameras.find(camera => camera.id === id);
    }
    async getVideoStream(options?: MediaStreamOptions): Promise<MediaObject> {
        const camera = this.findCamera();
        const vsos = await this.getVideoStreamOptions();
        const vso = vsos.find(check => check.id === options?.id) || vsos[0];

        const rtspChannel = camera.channels.find(check => check.id.toString() === vso.id);

        const { rtspAlias } = rtspChannel;
        const ip = (this.protect.getSetting('useConnectionHost') !== 'false' && camera.connectionHost) || this.protect.getSetting('ip');
        const u = `rtsps://${ip}:7441/${rtspAlias}`

        const data = Buffer.from(JSON.stringify({
            url: u,
            container: 'rtsp',
            mediaStreamOptions: this.createMediaStreamOptions(rtspChannel, (camera as any).videoCodec),
        } as MediaStreamUrl));
        return this.createMediaObject(data, ScryptedMimeTypes.MediaStreamUrl);
    }

    createMediaStreamOptions(channel: ProtectCameraChannelConfig, cameraVideoCodec: string) {
        const ret: ResponseMediaStreamOptions = {
            id: channel.id.toString(),
            name: channel.name,
            video: {
                codec: cameraVideoCodec || 'h264',
                width: channel.width,
                height: channel.height,
                bitrate: channel.maxBitrate,
                minBitrate: channel.minBitrate,
                maxBitrate: channel.maxBitrate,
                fps: channel.fps,
                keyframeInterval: channel.idrInterval * channel.fps,
            },
            audio: {
                codec: 'aac',
            },
            // mark this rtsp stream as created by scrypted, even though it is not.
            // it's been tested as compatible with the scrypted RTSPClient.
            // this allows bypassing usage of ffmpeg.
            tool: 'scrypted',
            container: 'rtsp',
        };
        return ret;
    }

    async getVideoStreamOptions(): Promise<ResponseMediaStreamOptions[]> {
        const camera = this.findCamera();
        const vsos = camera.channels
            .map(channel => this.createMediaStreamOptions(channel, (camera as any).videoCodec));

        return vsos;
    }

    async setVideoStreamOptions(options: MediaStreamOptions): Promise<MediaStreamConfiguration> {
        const bitrate = options?.video?.bitrate;
        if (!bitrate)
            return;

        const camera = this.findCamera();
        const channel = camera.channels.find(channel => channel.id.toString() === options.id);

        const sanitizedBitrate = Math.min(channel.maxBitrate, Math.max(channel.minBitrate, bitrate));
        this.console.log(channel.name, 'bitrate change requested', bitrate, 'clamped to', sanitizedBitrate);
        channel.bitrate = sanitizedBitrate;
        const cameraResult = await this.protect.api.updateCameraChannels(camera);
        if (!cameraResult) {
            throw new Error("setVideoStreamOptions failed")
        }
    }

    async getPictureOptions(): Promise<ResponsePictureOptions[]> {
        return [
            {
                canResize: true,
                staleDuration: 10000,
            }
        ];
    }

    setMotionDetected(motionDetected: boolean) {
        this.motionDetected = motionDetected;
        if ((this.findCamera().featureFlags as any as FeatureFlagsShim).hasPackageCamera) {
            if (deviceManager.getNativeIds().includes(this.packageCameraNativeId)) {
                this.ensurePackageCamera();
                this.packageCamera.motionDetected = motionDetected;
            }
        }
    }

    setFingerprintDetected(fingerprintDetected: boolean) {
        if ((this.findCamera().featureFlags as any as FeatureFlagsShim).hasFingerprintSensor) {
            if (deviceManager.getNativeIds().includes(this.fingerprintSensorNativeId)) {
                this.ensureFingerprintSensor();
                this.fingerprintSensor.binaryState = fingerprintDetected;
            }
        }
    }

    async sendNotification(title: string, options?: NotifierOptions, media?: MediaObject | string, icon?: MediaObject | string) {
        const payload: ProtectCameraLcdMessagePayload = {
            text: title.substring(0, 30),
            type: 'CUSTOM_MESSAGE',
        };
        this.protect.api.updateCamera(this.findCamera(), {
            lcdMessage: payload,
        })

        if (typeof media === 'string') {
            media = await mediaManager.createMediaObjectFromUrl(media, { sourceId: this.id });
        }
        if (media) {
            if (typeof media === 'string') {
                media = await mediaManager.createMediaObjectFromUrl(media, { sourceId: this.id });
            }
            this.startIntercom(media);
        }
    }

    updateState(camera?: Readonly<ProtectCameraConfigInterface>) {
        camera = camera || this.findCamera();
        if (!camera)
            return;
        this.on = !!camera.ledSettings?.isEnabled;
        const online = !!camera.isConnected;
        if (online !== this.online)
            this.online = online;
        if (!!camera.isMotionDetected)
            debounceMotionDetected(this);

        if (!!camera.featureFlags.canOpticalZoom) {
            this.ptzCapabilities = { pan: false, tilt: false, zoom: true };
        }
    }
}
