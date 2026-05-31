import { listenSingleRtspClient } from '@scrypted/common/src/rtsp-server';
import { addTrackControls, parseSdp } from '@scrypted/common/src/sdp-utils';
import sdk, { Battery, Camera, Device, DeviceProvider, FFmpegInput, MediaObject, MotionSensor, RequestMediaStreamOptions, RequestPictureOptions, ResponseMediaStreamOptions, ResponsePictureOptions, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting, Settings, SettingValue, VideoCamera } from '@scrypted/sdk';
import { StorageSettings } from '@scrypted/sdk/storage-settings';
import eufy, { CaptchaOptions, EufySecurity, P2PClientProtocol, P2PConnectionType } from 'eufy-security-client';
import { startRtpForwarderProcess } from '../../webrtc/src/rtp-forwarders';

import { Deferred } from '@scrypted/common/src/deferred';
import { Writable } from 'stream';
import { LocalLivestreamManager } from './stream';

const { deviceManager, mediaManager, systemManager } = sdk;

class EufyCamera extends ScryptedDeviceBase implements VideoCamera, MotionSensor {
  client: EufySecurity;
  device: eufy.Camera;

  constructor(nativeId: string, client: EufySecurity, device: eufy.Camera) {
    super(nativeId);
    this.client = client;
    this.device = device;
    this.setupMotionDetection();
  }

  setupMotionDetection() {
    const handle = (device: eufy.Device, state: boolean) => {
      this.motionDetected = state;
    };
    this.device.on('motion detected', handle);
    this.device.on('person detected', handle);
    this.device.on('pet detected', handle);
    this.device.on('vehicle detected', handle);
    this.device.on('dog detected', handle);
    this.device.on('radar motion detected', handle);
  }

  getVideoStream(options?: ResponseMediaStreamOptions): Promise<MediaObject> {
    return this.createVideoStream(options);
  }

  async getVideoStreamOptions(): Promise<ResponseMediaStreamOptions[]> {
    return [
      {
        container: 'rtsp',
        id: 'p2p',
        name: 'P2P',
        video: {
          codec: 'h264',
        },
        audio: {
          codec: 'aac',
        },
        tool: 'scrypted',
        userConfigurable: false,
      },
      {
        container: 'rtsp',
        id: 'p2p-low',
        name: 'P2P (Low Resolution)',
        video: {
          codec: 'h264',
          width: 1280,
          height: 720,
        },
        audio: {
          codec: 'aac',
        },
        tool: 'scrypted',
        userConfigurable: false,
      },
    ];
  }

  async createVideoStream(options?: ResponseMediaStreamOptions): Promise<MediaObject> {
    const livestreamManager = new LocalLivestreamManager(options.id, this.client, this.device, this.console);

    const kill = new Deferred<void>();
    kill.promise.finally(() => {
      this.console.log('video stream exited');
      livestreamManager.stopLocalLiveStream();
    });

    const rtspServer = await listenSingleRtspClient();
    rtspServer.rtspServerPromise.then(async rtsp => {
      kill.promise.finally(() => rtsp.client.destroy());
      rtsp.client.on('close', () => kill.resolve());
      try {
        const process = await startRtpForwarderProcess(this.console, {
          inputArguments: [
            '-f', 'h264', '-i', 'pipe:4',
            '-f', 'aac', '-i', 'pipe:5',
          ]
        }, {
          video: {
            onRtp: rtp => {
              if (videoTrack)
                rtsp.sendTrack(videoTrack.control, rtp, false);
            },
            encoderArguments: [
              '-vcodec', 'copy',
            ]
          },
          audio: {
            onRtp: rtp => {
              if (audioTrack)
                rtsp.sendTrack(audioTrack.control, rtp, false);
            },
            encoderArguments: [
              '-acodec', 'copy',
              '-rtpflags', 'latm',
            ]
          }
        });

        process.killPromise.finally(() => kill.resolve());
        kill.promise.finally(() => process.kill());

        let parsedSdp: ReturnType<typeof parseSdp>;
        let videoTrack: typeof parsedSdp.msections[0]
        let audioTrack: typeof parsedSdp.msections[0]
        process.sdpContents.then(async sdp => {
          sdp = addTrackControls(sdp);
          rtsp.sdp = sdp;
          parsedSdp = parseSdp(sdp);
          videoTrack = parsedSdp.msections.find(msection => msection.type === 'video');
          audioTrack = parsedSdp.msections.find(msection => msection.type === 'audio');
          await rtsp.handlePlayback();
        });

        const proxyStream = await livestreamManager.getLocalLivestream();
        proxyStream.videostream.pipe(process.cp.stdio[4] as Writable);
        proxyStream.audiostream.pipe((process.cp.stdio as any)[5] as Writable);
      }
      catch (e) {
        rtsp.client.destroy();
      }
    });

    const input: FFmpegInput = {
      url: rtspServer.url,
      mediaStreamOptions: options,
      inputArguments: [
        '-i', rtspServer.url,
      ]
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
    captcha: {
      title: 'Captcha',
      description: 'Optional: If a captcha request is recieved, enter the code in the image.',
      onPut: async (oldValue, newValue) => {
        await this.tryLogin(undefined, newValue);
      },
      noStore: true,
    },
    captchaId: {
      title: 'Captcha Id',
      hide: true,
    }
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

  async tryLogin(twoFactorCode?: string, captchaCode?: string) {
    this.log.clearAlerts();

    if (!this.storageSettings.values.email || !this.storageSettings.values.email) {
      this.log.a('Enter your Eufy email and password to complete setup.');
      throw new Error('Eufy email and password are missing.');
    }

    await this.initializeClient();

    var captchaOptions: CaptchaOptions = undefined
    if (captchaCode) {
      captchaOptions = {
        captchaCode: captchaCode,
        captchaId: this.storageSettings.values.captchaId,
      }

    }

    await this.client.connect({ verifyCode: twoFactorCode, captcha: captchaOptions, force: false });
  }

  private async initializeClient() {
    const config = {
      username: this.storageSettings.values.email,
      password: this.storageSettings.values.password,
      country: this.storageSettings.values.country,
      language: 'en',
      p2pConnectionSetup: P2PConnectionType.QUICKEST,
      pollingIntervalMinutes: 10,
      eventDurationSeconds: 10
    }
    this.client = await EufySecurity.initialize(config);
    this.client.on('device added', this.deviceAdded.bind(this));
    this.client.on('station added', this.stationAdded.bind(this));
    this.client.on('tfa request', () => {
      this.log.a('Login failed: 2FA is enabled, check your email or texts for your code, then enter it into the Two Factor Code setting to complete login.');
    });
    this.client.on('captcha request', (id, captcha) => {
      this.log.a(`Login failed: Captcha was requested, fill out the Captcha setting to complete login. </br> <img src="${captcha}" />`);
      this.storageSettings.putSetting('captchaId', id);
    });
    this.client.on('connect', () => {
      this.console.debug(`[${this.name}] (${new Date().toLocaleString()}) Client connected.`);
      this.log.clearAlerts();
    });
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
      ScryptedInterface.VideoCamera
    ];
    if (eufyDevice.hasBattery())
      interfaces.push(ScryptedInterface.Battery);
    if (eufyDevice.hasProperty('motionDetection'))
      interfaces.push(ScryptedInterface.MotionSensor);

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
