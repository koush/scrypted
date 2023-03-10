import sdk, { Battery, Camera, Device, DeviceProvider, FFmpegInput, MediaObject, RequestPictureOptions, ResponseMediaStreamOptions, ResponsePictureOptions, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting, Settings, SettingValue, VideoCamera } from '@scrypted/sdk';
import { StorageSettings } from '@scrypted/sdk/storage-settings';
import eufy, { EufySecurity } from 'eufy-security-client';
import { LocalLivestreamManager } from './stream';
import { listenZeroSingleClient } from '@scrypted/common/src/listen-cluster';
import child_process from 'child_process';
import { ffmpegLogInitialOutput } from '@scrypted/common/src/media-helpers';


const { deviceManager, mediaManager } = sdk;

class EufyCamera extends ScryptedDeviceBase implements Camera, VideoCamera, Battery {
  client: EufySecurity;
  device: eufy.Camera;
  livestreamManager: LocalLivestreamManager

  constructor(nativeId: string, client: EufySecurity, device: eufy.Camera) {
    super(nativeId);
    this.client = client;
    this.device = device;
    this.livestreamManager = new LocalLivestreamManager(this.client, this.device, false, this.console);

    // this.batteryLevel = this.device.getBatteryValue() as number;
  }

  takePicture(options?: RequestPictureOptions): Promise<MediaObject> {
    const url = this.device.getLastCameraImageURL();
    return mediaManager.createMediaObjectFromUrl(url.toString());
  }

  getPictureOptions(): Promise<ResponsePictureOptions[]> {
    return;
  }

  getVideoStream(options?: ResponseMediaStreamOptions): Promise<MediaObject> {
    return this.createVideoStream(options);
  }

  async getVideoStreamOptions(): Promise<ResponseMediaStreamOptions[]> {
    return [
      {
        id: 'p2p',
        name: 'P2P',
        video: {
          codec: 'h264',
        },
        audio: {
          codec: 'aac',
        },
        tool: 'ffmpeg',
        userConfigurable: false,
      }
    ];
  }

  async createVideoStream(options?: ResponseMediaStreamOptions): Promise<MediaObject> {
    const h264Server = await listenZeroSingleClient();
    const adtsServer = await listenZeroSingleClient();
    const proxyStream = await this.livestreamManager.getLocalLivestream();
    (async () => {
      const adts = await adtsServer.clientPromise;
      proxyStream.audiostream.pipe(adts);
    })();
    (async () => {
      const h264 = await h264Server.clientPromise;
      proxyStream.videostream.pipe(h264);
    })();


    const mpegts = await listenZeroSingleClient();

    mpegts.clientPromise.then(async client => {
      const cp = child_process.spawn(await mediaManager.getFFmpegPath(), [
        '-f', 'aac',
        '-i', adtsServer.url,
        '-f', 'h264',
        '-i', h264Server.url,

        '-acodec', 'copy',
        // try testing with and without this audio filter
        // '-bsf:a', 'aac_adtstoasc',

        '-vcodec', 'copy',
        '-f', 'mpegts',
        'pipe:3',
      ], {
        stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
      });

      cp.stdio[3].pipe(client);
    });

    const input: FFmpegInput = {
      url: undefined,
      inputArguments: [
        '-f', 'mpegts',
        '-i', mpegts.url,
      ],
      mediaStreamOptions: options,
    };

    return mediaManager.createFFmpegMediaObject(input);
  }
}

class EufyPlugin extends ScryptedDeviceBase implements DeviceProvider, Settings {
  client: EufySecurity;
  devices = new Map<string, any>();

  storageSettings = new StorageSettings(this, {
    country: {
      title: 'Country',
      defaultValue: 'US',
    },
    email: {
      title: 'Email',
      onPut: async () => this.tryLogin(),
    },
    password: {
      title: 'Password',
      type: 'password',
      onPut: async () => this.tryLogin(),
    },
    twoFactorCode: {
      title: 'Two Factor Code',
      description: 'Optional: If 2FA is enabled on your account, enter the code sent to your email or phone number.',
      onPut: async (oldValue, newValue) => {
        await this.tryLogin(newValue);
      },
      noStore: true,
    },
  });

  constructor() {
    super();
    this.tryLogin()
  }

  getSettings(): Promise<Setting[]> {
    return this.storageSettings.getSettings();
  }

  putSetting(key: string, value: SettingValue): Promise<void> {
    return this.storageSettings.putSetting(key, value);
  }

  async tryLogin(twoFactorCode?: string) {
    this.log.clearAlerts();

    if (!this.storageSettings.values.email || !this.storageSettings.values.email) {
      this.log.a('Enter your Eufy email and password to complete setup.');
      throw new Error('Eufy email and password are missing.');
    }

    await this.initializeClient();

    try {
      await this.client.connect({ verifyCode: twoFactorCode, force: false });
      this.console.debug(`[${this.name}] (${new Date().toLocaleString()}) Client connected.`);
    } catch (e) {
      this.log.a('Login failed: if you have 2FA enabled, check your email or texts for your code, then enter it into the Two Factor Code setting to conplete login.');
      this.console.error(`[${this.name}] (${new Date().toLocaleString()}) Client failed to connect.`, e);
    }
  }

  private async initializeClient() {
    const config = {
      username: this.storageSettings.values.email,
      password: this.storageSettings.values.password,
      country: this.storageSettings.values.country,
      language: 'en',
      p2pConnectionSetup: 2,
      pollingIntervalMinutes: 10,
      eventDurationSeconds: 10
    }
    this.client = await EufySecurity.initialize(config);
    this.client.on('device added', this.deviceAdded.bind(this));
    this.client.on('station added', this.stationAdded.bind(this));

    this.client.on('push connect', () => {
      this.console.log(`[${this.name}] (${new Date().toLocaleString()}) Push Connected.`);
    });
    this.client.on('push close', () => {
      this.console.log(`[${this.name}] (${new Date().toLocaleString()}) Push Closed.`);
    });
  }

  private async deviceAdded(eufyDevice: eufy.Device) {
    if (!eufyDevice.isCamera) {
      this.console.info(`[${this.name}] (${new Date().toLocaleString()}) Ignoring unsupported discovered device: `, eufyDevice.getName(), eufyDevice.getModel());
      return;
    }
    this.console.info(`[${this.name}] (${new Date().toLocaleString()}) Device discovered: `, eufyDevice.getName(), eufyDevice.getModel());

    const nativeId = eufyDevice.getSerial();

    const interfaces = [
      ScryptedInterface.Camera,
      ScryptedInterface.VideoCamera
    ];
    if (eufyDevice.hasBattery())
      interfaces.push(ScryptedInterface.Battery);

    const device: Device = {
      info: {
        model: eufyDevice.getModel(),
        manufacturer: 'Eufy',
        firmware: eufyDevice.getSoftwareVersion(),
        serialNumber: nativeId
      },
      nativeId,
      name: eufyDevice.getName(),
      type: ScryptedDeviceType.Camera,
      interfaces,
    };

    this.devices.set(nativeId, new EufyCamera(nativeId, this.client, eufyDevice as eufy.Camera))
    await deviceManager.onDeviceDiscovered(device);
  }

  private async stationAdded(station: eufy.Station) {
    this.console.info(`[${this.name}] (${new Date().toLocaleString()}) Station discovered: `, station.getName(), station.getModel(), `but stations are not currently supported.`);
  }

  async getDevice(nativeId: string): Promise<any> {
    return this.devices.get(nativeId);
  }

  async releaseDevice(id: string, nativeId: string) {
    this.console.info(`[${this.name}] (${new Date().toLocaleString()}) Device with id '${nativeId}' was removed.`);
  }

}

export default new EufyPlugin();
