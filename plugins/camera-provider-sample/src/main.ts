import { BinarySensor, Camera, Device, DeviceDiscovery, DeviceProvider, FFmpegInput, Intercom, MediaObject, MediaStreamOptions, MotionSensor, PictureOptions, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, Setting, Settings, SettingValue, VideoCamera } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import { StorageSettings } from '../../../common/src/settings';

const { log, deviceManager, mediaManager } = sdk;

class SampleCameraDevice extends ScryptedDeviceBase implements Intercom, Camera, VideoCamera, MotionSensor, BinarySensor {
    constructor(public plugin: SampleCameraPlugin, nativeId: string) {
        super(nativeId);
    }

    async takePicture(options?: PictureOptions): Promise<MediaObject> {
        // fill this with a jpeg buffer
        const snapshot: Buffer = undefined;
        return mediaManager.createMediaObject(snapshot, 'image/jpeg');
    }

    async getPictureOptions(): Promise<PictureOptions[]> {
        // can optionally provide the different resolutions of images that are available.
        // used by homekit, if available.
        return;
    }

    async getVideoStream(options?: MediaStreamOptions): Promise<MediaObject> {
        let ffmpegInput: FFmpegInput;

        // the input arguemnt to ffmpeg can be any valid ffmpeg input argument.
        // if its an url, note below that it is.
        const url = 'rtmp://server/whatever';
        ffmpegInput = {
            // the input doesn't HAVE to be an url, but if it is, provide this hint.
            url,
            inputArguments: [
                '-i', url,
            ]
        };

        return mediaManager.createMediaObject(Buffer.from(JSON.stringify(ffmpegInput)), ScryptedMimeTypes.FFmpegInput);
    }

    async getVideoStreamOptions(): Promise<MediaStreamOptions[]> {
        return;
    }


    async startIntercom(media: MediaObject): Promise<void> {
        const ffmpegInput: FFmpegInput = JSON.parse((await mediaManager.convertMediaObjectToBuffer(media, ScryptedMimeTypes.FFmpegInput)).toString());
        // something wants to start playback on the camera speaker.
        // use their ffmpeg input arguments to spawn ffmpeg to do playback.
        // some implementations read the data from an ffmpeg pipe output and POST to a url (like unifi/amcrest).
        throw new Error('not implemented');
    }

    async stopIntercom(): Promise<void> {
    }

    // most cameras have have motion and doorbell press events, but dont notify when the event ends.
    // so set a timeout ourselves to reset the state.
    triggerBinaryState() {
        this.binaryState = true;
        setTimeout(() => this.binaryState = false, 10000);
    }

    // most cameras have have motion and doorbell press events, but dont notify when the event ends.
    // so set a timeout ourselves to reset the state.
    triggerMotion() {
        this.motionDetected = true;
        setTimeout(() => this.motionDetected = false, 10000);
    }
}

class SampleCameraPlugin extends ScryptedDeviceBase implements DeviceProvider, DeviceDiscovery, Settings {
    devices = new Map<string, SampleCameraDevice>();
    cameras: SampleCameraDevice[];

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
        twoFactorCode: {
            title: 'Two Factor Code',
            description: 'Optional: If 2 factor is enabled on your account, enter the code sent to your email or phone number.',
            onPut: async (oldValue, newValue) => {
                await this.tryLogin(newValue);
                await this.discoverDevices(0);
            },
            noStore: true,
        },
    }, this.storage);

    constructor() {
        super();
        this.discoverDevices(0);
    }

    clearTryDiscoverDevices() {
        // add code to clear any refresh tokens, etc, here. login changed.

        this.discoverDevices(0);
    }

    async tryLogin(twoFactorCode?: string) {
        // this shows a user alert in the ui
        this.log.a('Login failed! Is your username correct?');
        throw new Error('login failed');
    }

    getSettings(): Promise<Setting[]> {
        return this.settingsStorage.getSettings();
    }

    putSetting(key: string, value: SettingValue): Promise<void> {
        return this.settingsStorage.putSetting(key, value);
    }

    async discoverDevices(duration: number) {
        await this.tryLogin();
        // add code to retrieve the list of cameras.
        const cameras: any[] = [];
        this.cameras = cameras;
        const devices: Device[] = [];
        for (const camera of cameras) {
            const nativeId = camera.id.toString();
            const interfaces = [
                ScryptedInterface.Camera,
                ScryptedInterface.VideoCamera,
                ScryptedInterface.MotionSensor,
            ];
            if (camera.isDoorbell) {
                interfaces.push(
                    ScryptedInterface.BinarySensor,
                    ScryptedInterface.Intercom
                );
            }
            const device: Device = {
                info: {
                    model: camera.model,
                    manufacturer: 'Sample Camera Manufacturer',
                },
                nativeId,
                name: camera.name,
                type: camera.isDoorbell ? ScryptedDeviceType.Doorbell : ScryptedDeviceType.Camera,
                interfaces,
            };
            devices.push(device);

            // sample code to listen and report doorbell/motion events.
            // varies by api
            camera.on('doorbell',() => {
                const camera = this.devices.get(nativeId);
                camera?.triggerBinaryState();
            });
            // sample code to listen and report doorbell/motion events.
            // varies by api
            camera.on('motion', () => {
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
            const camera = new SampleCameraDevice(this, nativeId);
            this.devices.set(nativeId, camera);
        }
        return this.devices.get(nativeId);
    }
}

export default new SampleCameraPlugin();
