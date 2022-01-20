import { BinarySensor, Camera, Device, DeviceDiscovery, DeviceProvider, FFMpegInput, Intercom, MediaObject, MediaStreamOptions, MotionSensor, PictureOptions, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, Setting, Settings, SettingValue, VideoCamera } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import { SipSession, RingApi, RingCamera, RtpDescription, RingRestClient } from './ring-client-api';
import { StorageSettings } from '../../../common/src/settings';
import { listenZeroSingleClient } from '../../../common/src/listen-cluster';
import { encodeSrtpOptions, RtpSplitter } from '@homebridge/camera-utils'
import child_process from 'child_process';

const { log, deviceManager, mediaManager } = sdk;

class RingCameraDevice extends ScryptedDeviceBase implements Intercom, Camera, VideoCamera, MotionSensor, BinarySensor {
    session: SipSession;
    rtpDescription: RtpDescription;
    constructor(public plugin: RingPlugin, nativeId: string) {
        super(nativeId);
    }

    async takePicture(options?: PictureOptions): Promise<MediaObject> {
        const camera = this.findCamera();
        const snapshot = await camera.getSnapshot();
        return mediaManager.createMediaObject(snapshot, 'image/jpeg');
    }

    async getPictureOptions(): Promise<PictureOptions[]> {
        return;
    }

    async getVideoStream(options?: MediaStreamOptions): Promise<MediaObject> {
        // the ring-api-client can negotiate the sip connection and output the stream
        // to a ffmpeg output target.
        // provide a tcp socket to write, and then proxy that back as an ffmpeg input
        // to the caller.

        // this is from sip
        const { clientPromise, url } = await listenZeroSingleClient();
        const camera = this.findCamera();

        const sip = await camera.createSipSession({
            skipFfmpegCheck: true,
        })
        this.rtpDescription = await sip.start();
        const videoPort = await sip.reservePort(1);
        const audioPort = await sip.reservePort(1);
        
        const ff = sip.prepareTranscoder(true, [], this.rtpDescription, audioPort, videoPort, url);
        clientPromise.then(client => {
            client.write(ff.inputSdpLines.filter((x) => Boolean(x)).join('\n'));
            client.end();
        });

        const index = ff.ffmpegInputArguments.indexOf('-protocol_whitelist');
        ff.ffmpegInputArguments.splice(index, 2);

        const ffmpegInput: FFMpegInput = {
            url: undefined,
            inputArguments: ff.ffmpegInputArguments.filter(line => !!line).map(line => line.toString()),
        };

        return mediaManager.createMediaObject(Buffer.from(JSON.stringify(ffmpegInput)), ScryptedMimeTypes.FFmpegInput);
    }

    async getVideoStreamOptions(): Promise<MediaStreamOptions[]> {
        return [{
            id: 'default',
            video: {
                codec: 'h264',
            },
            audio: {
                // this is a hint to let homekit, et al, know that it's PCM audio and needs transcoding.
                codec: 'pcm',
            }
        }]
    }

    async startIntercom(media: MediaObject): Promise<void> {
        if (!this.session)
            throw new Error("not in call");

        const ringRtpOptions = this.rtpDescription;
        const ringAudioLocation = {
            port: ringRtpOptions.audio.port,
            address: ringRtpOptions.address,
        };
        const audioOutForwarder = new RtpSplitter(({ message }) => {
            // Splitter is needed so that transcoded audio can be sent out through the same port as audio in
            this.session.audioSplitter.send(message, ringAudioLocation).catch(e => this.console.error('audio splitter error', e))
            return null
        });

        const ffmpegInput: FFMpegInput = JSON.parse((await mediaManager.convertMediaObjectToBuffer(media, ScryptedMimeTypes.FFmpegInput)).toString());
        const args = ffmpegInput.inputArguments.slice();
        args.push(
            '-vn', '-dn', '-sn',
            '-acodec', 'pcm_mulaw',
            '-flags', '+global_header',
            '-ac', '1',
            '-ar', '8k',
            '-f', 'rtp',
            '-srtp_out_suite', 'AES_CM_128_HMAC_SHA1_80',
            '-srtp_out_params', encodeSrtpOptions(this.session.rtpOptions.audio),
            `srtp://127.0.0.1:${await audioOutForwarder.portPromise}?pkt_size=188`,
        );

        const cp = child_process.spawn(await mediaManager.getFFmpegPath(), args);
        this.session.onCallEnded.subscribe(() => cp.kill('SIGKILL'));
    }
    stopIntercom(): Promise<void> {
        throw new Error('Method not implemented.');
    }

    triggerBinaryState() {
        this.binaryState = true;
        setTimeout(() => this.binaryState = false, 10000);
    }
    triggerMotion() {
        this.motionDetected = true;
        setTimeout(() => this.motionDetected = false, 10000);
    }

    findCamera() {
        return this.plugin.cameras.find(camera => camera.id.toString() === this.nativeId);
    }


}

class RingPlugin extends ScryptedDeviceBase implements DeviceProvider, DeviceDiscovery, Settings {
    client: RingRestClient;
    api: RingApi;
    devices = new Map<string, RingCameraDevice>();
    cameras: RingCamera[];

    settingsStorage = new StorageSettings(this, {
        email: {
            title: 'Email',
            onPut: async () => this.clearTryDiscoverDevices(),
        },
        password: {
            title: 'Password',
            type: 'password',
            onPut: async () => this.clearTryDiscoverDevices(),
        },
        loginCode: {
            title: 'Two Factor Code',
            description: 'Optional: If 2 factor is enabled on your Ring account, enter the code sent by Ring to your email or phone number.',
            onPut: async (oldValue, newValue) => {
                await this.tryLogin(newValue);
                this.console.log('login completed successfully with 2 factor code');
                await this.discoverDevices(0);
                this.console.log('discovery completed successfully');
            },
            noStore: true,
        },
        refreshToken: {
            hide: true,
        },
        locationIds: {
            title: 'Location ID',
            description: 'Optional: If supplied will on show this locationID.',
            hide: true,
        },
        cameraDingsPollingSeconds: {
            title: 'Poll Interval',
            type: 'number',
            description: 'Optional: Change the default polling interval for motion and doorbell events.',
        }
    });

    constructor() {
        super();
        this.discoverDevices(0);
    }

    async clearTryDiscoverDevices() {
        this.settingsStorage.values.refreshToken = undefined;
        this.client = undefined;
        await this.discoverDevices(0);
        this.console.log('discovery completed successfully');
    }

    async tryLogin(code?: string) {
        if (this.settingsStorage.values.refreshToken) {
            this.client = new RingRestClient({
                refreshToken: this.settingsStorage.values.refreshToken,
            });
            this.api = new RingApi({
                refreshToken: this.settingsStorage.values.refreshToken,
                ffmpegPath: await mediaManager.getFFmpegPath(),
                locationIds: this.settingsStorage.values.locationIds ? [this.settingsStorage.values.locationIds] : undefined,
                cameraDingsPollingSeconds: this.settingsStorage.values.cameraDingsPollingSeconds
            });
            return;
        }

        if (!this.settingsStorage.values.email || !this.settingsStorage.values.password)
            return;

        if (!code) {
            this.client = new RingRestClient({
                email: this.settingsStorage.values.email,
                password: this.settingsStorage.values.password,
            });
            try {
                const auth = await this.client.getCurrentAuth();
                this.settingsStorage.values.refreshToken = auth.refresh_token;
            }
            catch (e) {
                if (this.client.promptFor2fa) {
                    this.log.a('Check your email or texts for your Ring login code, then enter it into the Two Factor Code setting to conplete login.');
                    return;
                }
                this.console.error(e);
                this.log.a('Login failed.');
                return;
            }
        }
        else {
            try {
                const auth = await this.client.getAuth(code);
                this.settingsStorage.values.refreshToken = auth.refresh_token;
            }
            catch (e) {
                this.console.error(e);
                this.log.a('Login failed.');
                return;
            }
        }
        this.api = new RingApi({
            refreshToken: this.settingsStorage.values.refreshToken,
            ffmpegPath: await mediaManager.getFFmpegPath(),
        });
    }

    getSettings(): Promise<Setting[]> {
        return this.settingsStorage.getSettings();
    }
    putSetting(key: string, value: SettingValue): Promise<void> {
        return this.settingsStorage.putSetting(key, value);
    }
    async discoverDevices(duration: number) {
        await this.tryLogin();
        this.console.log('login success, trying discovery');
        const cameras = await this.api.getCameras();
        this.cameras = cameras;
        const devices: Device[] = [];
        for (const camera of cameras) {
            const nativeId = camera.id.toString();
            const interfaces = [
                ScryptedInterface.Camera,
                ScryptedInterface.VideoCamera,
                ScryptedInterface.MotionSensor,
                ScryptedInterface.Intercom
            ];
            if (camera.isDoorbot) {
                interfaces.push(
                    ScryptedInterface.BinarySensor,
                );
            }
            const device: Device = {
                info: {
                    model: `${camera.model} (${camera.data.kind})`,
                    manufacturer: 'Ring',
                    firmware: camera.data.firmware_version,
                    serialNumber: camera.data.device_id
                },
                nativeId,
                name: camera.name,
                type: camera.isDoorbot ? ScryptedDeviceType.Doorbell : ScryptedDeviceType.Camera,
                interfaces,
            };
            devices.push(device);

            camera.onDoorbellPressed?.subscribe(() => {
                const camera = this.devices.get(nativeId);
                camera?.triggerBinaryState();
            });
            camera.onMotionDetected?.subscribe(() => {
                const camera = this.devices.get(nativeId);
                camera?.triggerMotion();
            });
        }

        await deviceManager.onDevicesChanged({
            devices,
        });

        for (const camera of cameras) {
            this.getDevice(camera.id.toString());
        }
    }

    getDevice(nativeId: string) {
        if (!this.devices.has(nativeId)) {
            const camera = new RingCameraDevice(this, nativeId);
            this.devices.set(nativeId, camera);
        }
        return this.devices.get(nativeId);
    }
}

export default new RingPlugin();
