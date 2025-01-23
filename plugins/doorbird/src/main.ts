import { authHttpFetch } from "@scrypted/common/src/http-auth-fetch";
import { listenZero } from '@scrypted/common/src/listen-cluster';
import { ffmpegLogInitialOutput, safePrintFFmpegArguments } from "@scrypted/common/src/media-helpers";
import { readLength } from "@scrypted/common/src/read-stream";
import sdk, { BinarySensor, Camera, DeviceCreator, DeviceCreatorSettings, DeviceInformation, DeviceProvider, FFmpegInput, Intercom, MediaObject, MotionSensor, PictureOptions, ResponseMediaStreamOptions, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, Setting, Settings, VideoCamera } from '@scrypted/sdk';
import child_process, { ChildProcess } from 'child_process';
import { randomBytes } from 'crypto';
import net from 'net';
import { PassThrough, Readable } from "stream";
import { ApiMotionEvent, ApiRingEvent, DoorbirdAPI } from "./doorbird-api";

const { deviceManager, mediaManager } = sdk;

class DoorbirdCamera extends ScryptedDeviceBase implements Intercom, Camera, VideoCamera, Settings, BinarySensor, MotionSensor {
    doorbirdApi: DoorbirdAPI | undefined;
    binarySensorTimeout: NodeJS.Timeout;
    motionSensorTimeout: NodeJS.Timeout;
    doorbellAudioActive: boolean;
    audioTXProcess: ChildProcess;
    audioRXProcess: ChildProcess;
    audioSilenceProcess: ChildProcess;
    audioRXClientSocket: net.Socket;
    pendingPicture: Promise<MediaObject>;

    constructor(nativeId: string, public provider: DoorbirdCamProvider) {
        super(nativeId);
        this.binaryState = false;
        this.doorbellAudioActive = false;

        this.updateDeviceInfo();
    }

    getDoorbirdApi() {
        const ip = this.storage.getItem('ip');
        if (!ip)
            return undefined;

        if (!this.doorbirdApi) {
            this.doorbirdApi = new DoorbirdAPI(this.getIPAddress(), this.getUsername(), this.getPassword(), this.console);

            this.getDoorbirdApi()?.registerRingCallback((event: ApiRingEvent) => {
                this.console?.log("Ring event");
                this.console?.log("Event:", event.event);
                this.console?.log("Time:", event.timestamp);
                this.triggerBinarySensor();
            });
            this.getDoorbirdApi()?.registerMotionCallback((event: ApiMotionEvent) => {
                this.console?.log("Motion event");
                this.console?.log("Time:", event.timestamp);
                this.triggerMotionSensor();
            });
            this.getDoorbirdApi()?.startEventSocket();
        }
        return this.doorbirdApi;
    }

    async updateDeviceInfo(): Promise<void> {
        const ip = this.storage.getItem('ip');
        if (!ip)
            return;

        const deviceInfo: DeviceInformation = {
            ...this.info,
            ip
        };

        const response = await this.getDoorbirdApi()?.getInfo();

        deviceInfo.firmware = response.firmwareVersion + '-' + response.buildNumber;

        this.info = deviceInfo;
    }

    async takePicture(option?: PictureOptions): Promise<MediaObject> {
        if (!this.pendingPicture) {
            this.pendingPicture = this.takePictureThrottled(option);
            this.pendingPicture.finally(() => this.pendingPicture = undefined);
        }

        return this.pendingPicture;
    }

    async takePictureThrottled(option?: PictureOptions): Promise<MediaObject> {
        return this.createMediaObject(await this.getDoorbirdApi().getImage(), 'image/jpeg');
    }

    // Unfortunately, the Doorbird public API only offers JPEG snapshots with VGA resolution.
    // Recommendation: use the snapshot plugin to get snapshots with maximum resolution.
    public async getPictureOptions(): Promise<PictureOptions[]> {
        return [{
            id: 'VGA',
            picture: { width: 640, height: 480 }
        }];
    }

    public async putSetting(key: string, value: string | number | boolean) {

        this.doorbirdApi?.stopEventSocket();
        this.doorbirdApi = undefined;

        this.storage.setItem(key, value.toString());
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);

        this.provider.updateDevice(this.nativeId, this.name);
    }

    async getSettings(): Promise<Setting[]> {
        return [
            {
                key: 'username',
                title: 'Username',
                value: this.storage.getItem('username'),
                description: 'Required: Username for Doorbird HTTP API.',
            },
            {
                key: 'password',
                title: 'Password',
                value: this.storage.getItem('password'),
                type: 'password',
                description: 'Required: Password for Doorbird HTTP API.',
            },
            {
                key: 'ip',
                title: 'IP Address',
                placeholder: '192.168.1.100',
                value: this.storage.getItem('ip'),
                description: 'Required: IP address of the Doorbird station.',
            },
            {
                key: 'httpPort',
                subgroup: 'Advanced',
                title: 'HTTP Port Override',
                placeholder: '80',
                value: this.storage.getItem('httpPort'),
                description: 'Use this if you have some network firewall rules which change the HTTP port of the camera HTTP port.',
            },
            {
                key: 'rtspUrl',
                subgroup: 'Advanced',
                title: 'RTSP URL Override',
                placeholder: 'rtsp://192.168.2.100/my_doorbird_video_stream',
                value: this.storage.getItem('rtspUrl'),
                description: 'Use this in case you are already using another RTSP server/proxy (e.g. mediamtx, go2rtc, etc.) to limit the number of streams from the camera.',
            }
        ];
    }

    // When the intercom is started, we also start the audio receiver which receives audio fro the doorbird microphone.
    // This audio is then fed into ffmpeg instead of the silent audio from the silence generator.
    // We also start another process(audioTXProcess) which sends audio to the doorbird speaker.
    async startIntercom(media: MediaObject): Promise<void> {
        await this.startAudioReceiver();
        await this.startAudioTransmitter(media);
    }

    async stopIntercom(): Promise<void> {
        this.stopAudioTransmitter();
        this.stopAudioReceiver();
    }

    async startAudioTransmitter(media: MediaObject): Promise<void> {
        const ffmpegInput: FFmpegInput = JSON.parse((await mediaManager.convertMediaObjectToBuffer(media, ScryptedMimeTypes.FFmpegInput)).toString());

        const ffmpegArgs = ffmpegInput.inputArguments.slice();
        ffmpegArgs.push(
            '-vn', '-dn', '-sn',
            '-acodec', 'pcm_mulaw',
            '-flags', '+global_header',
            '-ac', '1',
            '-ar', '8k',
            '-f', 'mulaw',
            'pipe:3'
        );

        safePrintFFmpegArguments(console, ffmpegArgs);
        const cp = child_process.spawn(await mediaManager.getFFmpegPath(), ffmpegArgs, {
            stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
        });
        this.audioTXProcess = cp;
        ffmpegLogInitialOutput(console, cp);
        cp.on('exit', () => this.console.log('Doorbird: Audio transmitter ended.'));
        cp.stdout.on('data', data => this.console.log(data.toString()));
        cp.stderr.on('data', data => this.console.log(data.toString()));

        const socket = cp.stdio[3] as Readable;

        const username: string = this.getUsername();
        const password: string = this.getPassword();
        const audioTxUrl: string = `${this.getHttpBaseAddress()}/bha-api/audio-transmit.cgi`;

        this.console.log('Doorbird: Starting audio transmitter...');

        (async () => {
            this.console.log('Doorbird: audio transmitter started.');

            const passthrough = new PassThrough();
            authHttpFetch({
                method: 'POST',
                url: audioTxUrl,
                credential: {
                    username,
                    password,
                },
                headers: {
                    'Content-Type': 'audio/basic',
                    'Content-Length': '9999999'
                },
                data: passthrough,
            });

            try {
                while (true) {
                    const data = await readLength(socket, 1024);
                    passthrough.push(data);
                }
            }
            catch (e) {
            }
            finally {
                this.console.log('Doorbird: audio transmitter finished.');
                passthrough.end();
            }

            this.stopAudioTransmitter();
        })();
    }

    stopAudioTransmitter() {
        this.audioTXProcess?.kill('SIGKILL');
        this.audioTXProcess = undefined;
    }

    async startAudioReceiver(): Promise<void> {

        const audioRxUrl = `${this.getHttpBaseAddress()}/bha-api/audio-receive.cgi`;

        this.console.log('Doorbird: Starting audio receiver...');

        const ffmpegPath = await mediaManager.getFFmpegPath();

        const ffmpegArgs = [
            '-hide_banner',
            '-nostats',
            '-analyzeduration', '0',
            '-probesize', '32',
            '-re',
            '-ar', '8000',
            '-ac', '1',
            '-f', 'mulaw',
            '-i', `${audioRxUrl}`,
            '-acodec', 'copy',
            '-f', 'mulaw',
            'pipe:3'
        ];

        safePrintFFmpegArguments(console, ffmpegArgs);
        const cp = child_process.spawn(ffmpegPath, ffmpegArgs, {
            stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
        });
        this.audioRXProcess = cp;
        ffmpegLogInitialOutput(console, cp);

        cp.on('exit', () => {
            this.console.log('Doorbird: audio receiver ended.')
            this.audioRXProcess = undefined;
        });
        cp.stdout.on('data', data => this.console.log(data.toString()));
        cp.stderr.on('data', data => this.console.log(data.toString()));

        this.doorbellAudioActive = true;
        cp.stdio[3].on('data', data => {
            if (this.doorbellAudioActive && this.audioRXClientSocket) {
                this.audioRXClientSocket.write(data);
            }
        });
    }

    stopAudioReceiver() {
        this.doorbellAudioActive = false;
        this.audioRXProcess?.kill('SIGKILL');
        this.audioRXProcess = undefined;
    }

    async getVideoStreamOptions(): Promise<ResponseMediaStreamOptions[]> {
        return [{
            id: 'default',
            name: 'default',
            container: '', // must be empty to support prebuffering
            video: {
                codec: 'h264'
            },
            audio: { /*this.isAudioDisabled() ? null : {}, */
                // this is a hint to let homekit, et al, know that it's OPUS audio and does not need transcoding.
                codec: 'pcm_mulaw',
            }
        }];
    }

    async getVideoStream(options?: ResponseMediaStreamOptions): Promise<MediaObject> {

        const port = await this.startAudioRXServer();

        const ffmpegInput: FFmpegInput = {
            url: undefined,
            inputArguments: [
                '-analyzeduration', '0',
                '-probesize', '32',
                '-fflags', 'nobuffer',
                '-flags', 'low_delay',
                '-f', 'rtsp',
                '-rtsp_transport', 'tcp',
                '-i', `${this.getRtspAddress()}`,
                '-f', 'mulaw',
                '-ac', '1',
                '-ar', '8000',
                '-channel_layout', 'mono',
                '-use_wallclock_as_timestamps', 'true',
                '-i', `tcp://127.0.0.1:${port}?tcp_nodelay=1`,
            ],
            mediaStreamOptions: options,
        };

        return mediaManager.createFFmpegMediaObject(ffmpegInput);
    }

    async startSilenceGenerator() {

        if (this.audioSilenceProcess)
            return;

        this.console.log('Doorbird: starting audio silence generator...')

        const ffmpegPath = await mediaManager.getFFmpegPath();
        const ffmpegArgs = [
            '-hide_banner',
            '-nostats',
            '-re',
            '-f', 'lavfi',
            '-i', 'anullsrc=r=8000:cl=mono',
            '-f', 'mulaw',
            'pipe:3'
        ];

        safePrintFFmpegArguments(console, ffmpegArgs);
        const cp = child_process.spawn(ffmpegPath, ffmpegArgs, {
            stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
        });
        this.audioSilenceProcess = cp;
        ffmpegLogInitialOutput(console, cp);

        cp.on('exit', () => {
            this.console.log('Doorbird: audio silence generator ended.')
            this.audioSilenceProcess = undefined;
        });
        cp.stdout.on('data', data => this.console.log(data.toString()));
        cp.stderr.on('data', data => this.console.log(data.toString()));
        cp.stdio[3].on('data', data => {
            if (!this.doorbellAudioActive && this.audioRXClientSocket) {
                this.audioRXClientSocket.write(data);
            }
        });
    }

    stopSilenceGenerator() {
        this.audioSilenceProcess?.kill();
        this.audioSilenceProcess = null;
    }

    async startAudioRXServer(): Promise<number> {

        const server = net.createServer(async (clientSocket) => {
            clearTimeout(serverTimeout);

            this.audioRXClientSocket = clientSocket;

            this.startSilenceGenerator();

            this.audioRXClientSocket.on('close', () => {
                this.stopSilenceGenerator();
                this.audioRXClientSocket = null;
            });
        });
        const serverTimeout = setTimeout(() => {
            this.console.log('Doorbird: timed out waiting for tcp client from ffmpeg');
            server.close();
        }, 30000);
        const port = await listenZero(server, '127.0.0.1');

        return port;
    }

    triggerBinarySensor() {
        this.binaryState = true;
        clearTimeout(this.binarySensorTimeout);
        this.binarySensorTimeout = setTimeout(() => this.binaryState = false, 3000);
    }

    triggerMotionSensor() {
        this.motionDetected = true;
        clearTimeout(this.motionSensorTimeout);
        this.motionSensorTimeout = setTimeout(() => this.motionDetected = false, 3000);
    }

    setHttpPortOverride(port: string) {
        this.storage.setItem('httpPort', port || '');
    }

    getHttpBaseAddress() {
        return `http://${this.getUsername()}:${this.getPassword()}@${this.getIPAddress()}:${this.storage.getItem('httpPort') || 80}`;
    }

    getRtspAddress() {
        if (this.storage.getItem('rtspUrl') !== undefined) {
            return this.storage.getItem('rtspUrl');
        }
        else {
            return this.getRtspDefaultAddress();
        }
    }

    getRtspDefaultAddress() {
        return `rtsp://${this.getUsername()}:${this.getPassword()}@${this.getIPAddress()}/mpeg/media.amp`;
    }

    getIPAddress() {
        return this.storage.getItem('ip');
    }

    setIPAddress(ip: string) {
        return this.storage.setItem('ip', ip);
    }

    getUsername() {
        return this.storage.getItem('username');
    }

    getPassword() {
        return this.storage.getItem('password');
    }
}

export class DoorbirdCamProvider extends ScryptedDeviceBase implements DeviceProvider, DeviceCreator {

    devices = new Map<string, any>();

    constructor(nativeId?: string) {
        super(nativeId);

        for (const camId of deviceManager.getNativeIds()) {
            if (camId)
                this.getDevice(camId);
        }
    }

    async createDevice(settings: DeviceCreatorSettings, nativeId?: string): Promise<string> {

        let info: DeviceInformation = {};

        const host = settings.ip?.toString();
        const username = settings.username?.toString();
        const password = settings.password?.toString();
        const skipValidate = settings.skipValidate === 'true';

        if (!skipValidate) {
            const api = new DoorbirdAPI(host, username, password, this.console);
            try {
                const deviceInfo = await api.getInfo();

                settings.newCamera = deviceInfo.deviceType;
                info.model = deviceInfo.deviceType;
                info.serialNumber = deviceInfo.serialNumber;
                info.mac = deviceInfo.serialNumber;
                info.manufacturer = 'Bird Home Automation GmbH';
                info.managementUrl = 'https://webadmin.doorbird.com';
            }
            catch (e) {
                this.console.error('Error adding Doorbird camera', e);
                throw e;
            }
        }
        settings.newCamera ||= 'Doorbird Camera';

        nativeId ||= randomBytes(4).toString('hex');
        const name = settings.newCamera?.toString();
        await this.updateDevice(nativeId, name);

        const device = await this.getDevice(nativeId) as DoorbirdCamera;
        device.info = info;
        device.putSetting('username', username);
        device.putSetting('password', password);
        device.setIPAddress(settings.ip.toString());
        device.setHttpPortOverride(settings.httpPort?.toString());

        return nativeId;
    }

    async getCreateDeviceSettings(): Promise<Setting[]> {
        return [
            {
                key: 'username',
                title: 'Username',
            },
            {
                key: 'password',
                title: 'Password',
                type: 'password',
            },
            {
                key: 'ip',
                title: 'IP Address',
                placeholder: '192.168.2.222',
            },
            {
                key: 'httpPort',
                title: 'HTTP Port',
                description: 'Optional: Override the HTTP Port from the default value of 80',
                placeholder: '80',
            },
            {
                key: 'skipValidate',
                title: 'Skip Validation',
                description: 'Add the device without verifying the credentials and network settings.',
                type: 'boolean',
            }
        ]
    }

    updateDevice(nativeId: string, name: string) {
        return deviceManager.onDeviceDiscovered({
            nativeId,
            name,
            interfaces: [
                ScryptedInterface.Camera,
                ScryptedInterface.VideoCamera,
                ScryptedInterface.Settings,
                ScryptedInterface.Intercom,
                ScryptedInterface.BinarySensor,
                ScryptedInterface.MotionSensor
            ],
            type: ScryptedDeviceType.Doorbell,
            info: deviceManager.getNativeIds().includes(nativeId) ? deviceManager.getDeviceState(nativeId)?.info : undefined,
        });
    }

    getDevice(nativeId: string) {
        let ret = this.devices.get(nativeId);
        if (!ret) {
            ret = this.createCamera(nativeId);
            if (ret)
                this.devices.set(nativeId, ret);
        }
        return ret;
    }

    async releaseDevice(id: string, nativeId: string): Promise<void> {
        if (this.devices.delete(nativeId)) {
            this.console.log("Doorbird: Removed device from list: " + id + " / " + nativeId)
        }
    }

    createCamera(nativeId: string): DoorbirdCamera {
        return new DoorbirdCamera(nativeId, this);
    }
}

export default new DoorbirdCamProvider();
