import { getNaluTypesInNalu, listenSingleRtspClient } from '@scrypted/common/src/rtsp-server';
import { addTrackControls, parseSdp } from '@scrypted/common/src/sdp-utils';
import { H264Repacketizer, NAL_TYPE_IDR, NAL_TYPE_NON_IDR, splitH264NaluStartCode } from '@scrypted/h264-repacketizer/src/index';
import sdk, { Battery, Camera, Device, DeviceProvider, FFmpegInput, MediaObject, MediaStreamUrl, RequestPictureOptions, ResponseMediaStreamOptions, ResponsePictureOptions, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, Setting, Settings, SettingValue, VideoCamera } from '@scrypted/sdk';
import { StorageSettings } from '@scrypted/sdk/storage-settings';
import eufy, { CaptchaOptions, EufySecurity } from 'eufy-security-client';
import { LocalLivestreamManager } from './stream';
import { createBindZero, listenZeroSingleClient } from '@scrypted/common/src/listen-cluster';
import child_process from 'child_process';
import { ffmpegLogInitialOutput, safeKillFFmpeg, safePrintFFmpegArguments } from '@scrypted/common/src/media-helpers';
import { startRtpForwarderProcess } from '../../webrtc/src/rtp-forwarders';

import { RtpHeader, RtpPacket } from '../../../external/werift/packages/rtp/src/rtp/rtp';
import { Writable } from 'stream';
import { Deferred } from '@scrypted/common/src/deferred';
import { closeQuiet } from '@scrypted/common/src/listen-cluster';


const { deviceManager, mediaManager } = sdk;

let sdp: string;
if (true) {
  sdp = `v=0
  o=- 0 0 IN IP4 127.0.0.1
  t=0 0
  m=video 0 RTP/AVP 96
  c=IN IP4 0.0.0.0
  a=recvonly
  a=rtpmap:96 H264/90000
  m=audio 0 RTP/AVP 97
  c=IN IP4 0.0.0.0
  a=recvonly
  a=rtpmap:97 MP4A-LATM/16000/1
  a=fmtp:97 profile-level-id=40;cpresent=0;config=400028103fc0
`;

}
else {
  sdp = `v=0
  o=- 0 0 IN IP4 127.0.0.1
  t=0 0
  m=video 0 RTP/AVP 96
  c=IN IP4 0.0.0.0
  a=recvonly
  a=rtpmap:96 H264/90000
  `;
}


sdp = addTrackControls(sdp);
const parsedSdp = parseSdp(sdp);
const videoTrack = parsedSdp.msections.find(msection => msection.type === 'video');
const audioTrack = parsedSdp.msections.find(msection => msection.type === 'audio');

class EufyCamera extends ScryptedDeviceBase implements Camera, VideoCamera, Battery {
  client: EufySecurity;
  device: eufy.Camera;
  livestreamManager: LocalLivestreamManager

  constructor(nativeId: string, client: EufySecurity, device: eufy.Camera) {
    super(nativeId);
    this.client = client;
    this.device = device;
    this.livestreamManager = new LocalLivestreamManager(this.client, this.device, true, this.console);

    // this.batteryLevel = this.device.getBatteryValue() as number;
  }

  takePicture(options?: RequestPictureOptions): Promise<MediaObject> {
    const url = this.device.getLastCameraImageURL();
    if (!url)
      throw new Error("snapshot unavailable");
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
        container: 'rtsp',
        id: 'p2p',
        name: 'P2P',
        video: {
          codec: 'h264',
        },
        audio: audioTrack ? {
          codec: 'aac',
        } : null,
        tool: 'scrypted',
        userConfigurable: false,
      }
    ];
  }

  async createVideoStream(options?: ResponseMediaStreamOptions): Promise<MediaObject> {
    const kill = new Deferred<void>();
    kill.promise.finally(() => this.console.log('video stream proxy exited'));

    const rtspServer = await listenSingleRtspClient();
    rtspServer.rtspServerPromise.then(async rtsp => {
      kill.promise.finally(() => rtsp.client.destroy());
      rtsp.client.on('close', () => kill.resolve());

      rtsp.sdp = sdp;
      await rtsp.handlePlayback();

      const h264Packetizer = new H264Repacketizer(this.console, 64000, undefined);
      let videoSequenceNumber = 1;
      const firstTimestamp = Date.now();
      let lastVideoTimestamp = firstTimestamp;
      try {
        const ffmpeg = await mediaManager.getFFmpegPath();
        const audioUdp = await createBindZero();
        const videoUdp = await createBindZero();
        kill.promise.finally(() => closeQuiet(audioUdp.server))
        kill.promise.finally(() => closeQuiet(videoUdp.server))

        const proxyStream = await this.livestreamManager.getLocalLivestream();
        if (false) {
          proxyStream.videostream.on('close', () => rtsp.client.destroy());
          proxyStream.videostream.on('readable', () => {
            const allData: Buffer = proxyStream.videostream.read();
            const splits = splitH264NaluStartCode(allData);
            if (!splits.length)
              throw new Error('expected nalu start code');
  
            for (const nalu of splits) {
              const timestamp = Math.floor(((lastVideoTimestamp - firstTimestamp) / 1000) * 90000);
              const naluTypes = getNaluTypesInNalu(nalu);
              const header = new RtpHeader({
                sequenceNumber: videoSequenceNumber++,
                timestamp: timestamp,
                payloadType: 96,
              });
              const rtp = new RtpPacket(header, nalu);
  
              const packets = h264Packetizer.repacketize(rtp);
              for (const packet of packets) {
                rtsp.sendTrack(videoTrack.control, packet.serialize(), false);
              }
  
              if (naluTypes.has(NAL_TYPE_NON_IDR) || naluTypes.has(NAL_TYPE_IDR)) {
                lastVideoTimestamp = Date.now();
              }
            }
          });
        }
        else {
          const args = [
            '-hide_banner', '-y',
            '-f', 'h264',
            '-i', 'pipe:3',
            '-vcodec', 'copy',
            '-payload_type', '96',
            '-f', 'rtp',
            videoUdp.url.replace('udp:', 'rtp:'),
          ];
          safePrintFFmpegArguments(this.console, args);
          const cp = child_process.spawn(ffmpeg, args, {
            stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
          });
          kill.promise.finally(() => safeKillFFmpeg(cp));
          cp.on('exit', () => kill.resolve());
          proxyStream.videostream.pipe(cp.stdio[3] as Writable);
          videoUdp.server.on('message', message => {
            rtsp.sendTrack(videoTrack.control, message, false);
          });
        }

        if (audioTrack) {
          const args = [
            '-hide_banner', '-y',
            '-f', 'aac',
            '-i', 'pipe:3',
            '-acodec', 'copy',
            '-rtpflags', 'latm',
            '-payload_type', '97',
            '-f', 'rtp',
            audioUdp.url.replace('udp:', 'rtp:'),
          ];
          safePrintFFmpegArguments(this.console, args);
          const cp = child_process.spawn(ffmpeg, args, {
            stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
          });
          kill.promise.finally(() => safeKillFFmpeg(cp));
          cp.on('exit', () => kill.resolve());
          proxyStream.audiostream.pipe(cp.stdio[3] as Writable);
          audioUdp.server.on('message', message => {
            rtsp.sendTrack(audioTrack.control, message, false);
          });
        }
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
      p2pConnectionSetup: 2,
      pollingIntervalMinutes: 10,
      eventDurationSeconds: 10
    }
    this.client = await EufySecurity.initialize(config);
    this.client.on('device added', this.deviceAdded.bind(this));
    this.client.on('station added', this.stationAdded.bind(this));

    this.client.on('tfa request', () => {
      this.log.a('Login failed: 2FA is enabled, check your email or texts for your code, then enter it into the Two Factor Code setting to conplete login.');
    });
    this.client.on('captcha request', (id, captcha) => {
      this.log.a(`Login failed: Captcha was requested, fill out the Captcha setting to conplete login. </br> <img src="${captcha}" />`);
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
