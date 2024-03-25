import util from 'util';
import sdk, { Device, DeviceProvider, EngineIOHandler, HttpRequest, MediaObject, MediaPlayer, MediaPlayerOptions, MediaPlayerState, MediaStatus, Refresh, RTCSignalingChannel, RTCSignalingClient, RTCSignalingSession, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes } from '@scrypted/sdk';
import { EventEmitter } from 'events';
import mdns from 'multicast-dns';
import mime from 'mime';
import { createBrowserSignalingSession } from "@scrypted/common/src/rtc-connect";

const { mediaManager, endpointManager, deviceManager } = sdk;

const { DefaultMediaReceiver } = require('castv2-client');
const Client = require('castv2-client').Client;


function ScryptedMediaReceiver() {
  DefaultMediaReceiver.apply(this, arguments);
}
ScryptedMediaReceiver.APP_ID = '9D66005A';
util.inherits(ScryptedMediaReceiver, DefaultMediaReceiver);

class CastDevice extends ScryptedDeviceBase implements MediaPlayer, Refresh, EngineIOHandler, RTCSignalingClient {
  constructor(public provider: CastDeviceProvider, nativeId: string) {
    super(nativeId);
  }

  currentApp: any;
  playerPromise: Promise<any>;
  connectPlayer(app: any): Promise<any> {
    if (this.playerPromise) {
      if (this.currentApp === app && this.clientPromise) {
        return this.playerPromise;
      }

      this.playerPromise.then(player => {
        player.removeAllListeners();
        try {
          player.close();
        }
        catch (e) {
        }
      });
      this.playerPromise = undefined;
    }

    this.currentApp = app;
    return this.playerPromise = this.connectClient()
      .then(client => {
        return new Promise((resolve, reject) => {
          this.console.log('launching');
          client.launch(app, (err, player) => {
            if (err) {
              reject(err);
              return;
            }

            player.on('close', () => {
              this.console.log('player closed');
              player.removeAllListeners();
              this.playerPromise = undefined;
            });

            this.console.log('player launched.');
            resolve(player);
          });
        });
      })
      .catch(err => {
        this.playerPromise = undefined;
        throw err;
      });
  }

  clientPromise: Promise<any>;
  connectClient(): Promise<any> {
    if (this.clientPromise) {
      return this.clientPromise;
    }

    let promise;
    return this.clientPromise = promise = new Promise((resolve, reject) => {
      const client = new Client();

      const cleanup = () => {
        this.console.log('client close');
        if (this.clientPromise === promise) {
          this.clientPromise = undefined;
          this.playerPromise = undefined;
          this.mediaPlayerPromise = undefined;
        }

        client.removeAllListeners();
        try {
          client.close();
        } catch (e) {
        }
      }
      client.client.on('close', cleanup);
      client.on('error', err => {
        this.console.log(`Client error: ${err.message}`);
        cleanup();
        reject(err);
      });
      client.on('status', async status => {
        this.console.log(JSON.stringify(status));
        try {
          await this.joinPlayer();
        }
        catch (e) {
        }
      })

      let host = this.storage.getItem('host');
      client.connect(host, () => {
        this.console.log(`client connected.`);
        resolve(client);
      });
    })
  }

  tokens = new Map<string, MediaObject>();

  async sendMediaToClient(title: string, mediaUrl: string, mimeType: string, opts?: any) {
    const media: any = {
      // Here you can plug an URL to any mp4, webm, mp3 or jpg file with the proper contentType.
      contentId: mediaUrl,
      contentType: mimeType,
      streamType: 'BUFFERED', // or LIVE

      // Title and cover displayed while buffering
      metadata: {
        type: 0,
        metadataType: 0,
        title: title,
      },

      // these are internal APIs. TODO: make them public.
      customData: {
      }
    };

    opts = opts || {
      autoplay: true,
    }

    const player = await this.connectPlayer(DefaultMediaReceiver)
    player.load(media, opts, (err, status) => {
      if (err) {
        this.console.error(`load error: ${err}`);
        return;
      }
      this.console.log(`media loaded playerState=${status.playerState}`);
    });
  }

  async load(media: string | MediaObject, options: MediaPlayerOptions) {
    if (this.mediaPlayerPromise) {
      try {
        (await this.mediaPlayerPromise).close();
      } catch (e) {
      }
      this.mediaPlayerPromise = undefined;
      this.mediaPlayerStatus = undefined;
    }
    let url: string;
    let urlMimeType: string;

    //        http(s)   other:/
    // image   Direct   convert
    // video   Direct       RTC


    // convert this into a chromecast friendly url, or a media object that must be streamed.
    if (typeof media === 'string') {
      // always fetch images up front.
      if (options?.mimeType?.startsWith('image/')) {
        const mo = await mediaManager.createMediaObjectFromUrl(media);
        url = await mediaManager.convertMediaObjectToInsecureLocalUrl(mo, options?.mimeType);
      }
      else if (media.startsWith('http')) {
        // eh might not work, but whatever.
        url = media;
      }
      else {
        media = await mediaManager.createMediaObjectFromUrl(media);
      }
    }
    else if (options?.mimeType?.startsWith('image/') || options?.mimeType?.startsWith('audio/')) {
      url = await mediaManager.convertMediaObjectToInsecureLocalUrl(media, options?.mimeType);
    }

    if (url) {
      this.sendMediaToClient(options && (options as any).title,
        url,
        // prefer the provided mime type hint, otherwise infer from url.
        urlMimeType || options.mimeType || mime.getType(new URL(url).pathname));
      return;
    }

    // this media object is something weird that can't be handled by a straightforward url.
    // try to make a webrtc a/v session to handle it.
    const token = Math.random().toString();
    if (typeof media === 'string') {
      media = await mediaManager.createMediaObjectFromUrl(media);
    }
    this.tokens.set(token, media);

    return this.loadRTCSession(token, options?.title || 'Scrypted');
  }

  async loadRTCSession(token: string, title: string) {
    // this media object is something weird that can't be handled by a straightforward url.
    // try to make a webrtc a/v session to handle it.

    const engineio = await endpointManager.getPublicLocalEndpoint(this.nativeId) + 'engine.io/';
    const mo = await mediaManager.createMediaObject(Buffer.from(engineio), ScryptedMimeTypes.LocalUrl);
    let cameraStreamAuthToken: string;

    try {
      cameraStreamAuthToken = await mediaManager.convertMediaObjectToUrl(mo, ScryptedMimeTypes.LocalUrl);
    }
    catch (e) {
      this.log.a('Streaming failed. Install and set up Scrypted Cloud to cast this media type.');
      throw e;
    }

    const castMedia: any = {
      contentId: cameraStreamAuthToken,
      contentType: ScryptedMimeTypes.LocalUrl,
      streamType: 'LIVE',

      // Title and cover displayed while buffering
      metadata: {
        type: 0,
        metadataType: 0,
        title,
      },

      customData: {
        token,
      }
    };

    const opts = {
      autoplay: true,
    }

    const player = await this.connectPlayer(ScryptedMediaReceiver as any)
    player.load(castMedia, opts, (err, status) => {
      if (err) {
        this.console.error(`load error: ${err}`);
        return;
      }
      this.console.log(`media loaded playerState=${status.playerState}`);
    });
  }


  sessionDeferred: {
    resolve: any;
    reject: any;
  };

  async onConnection(request: HttpRequest, ws: WebSocket) {
    ws.onmessage = async (message) => {
      const json = JSON.parse(message.data as string);
      const { token } = json;

      if (token === 'scrypted') {
        if (!this.sessionDeferred) {
          ws.close();
          return;
        }

        const session = await createBrowserSignalingSession(ws, '@scrypted/chromecast', 'cast-receiver');
        this.sessionDeferred.resolve(session);
        this.sessionDeferred = undefined;
      }
      else {
        const mediaObject = this.tokens.get(token);
        if (!mediaObject) {
          ws.close();
          return;
        }

        const channel = await mediaManager.convertMediaObject<RTCSignalingChannel>(mediaObject, ScryptedMimeTypes.RTCSignalingChannel);
        const session = await createBrowserSignalingSession(ws, '@scrypted/chromecast', 'cast-receiver');
        await channel.startRTCSignalingSession(session);
      }
    }
  }

  createRTCSignalingSession(): Promise<RTCSignalingSession> {
    return new Promise((resolve, reject) => {
      const sessionDeferred = this.sessionDeferred = {
        resolve,
        reject,
      };

      this.loadRTCSession('scrypted', 'Scrypted');
      setTimeout(() => {
        sessionDeferred.reject(new Error('Timed Out waiting for RTCSignalingClientSession'));
        if (this.sessionDeferred === sessionDeferred)
          this.sessionDeferred = undefined;
      }, 30000)
    })
  }

  mediaPlayerPromise: Promise<any>;
  mediaPlayerStatus: any;
  joinPlayer(): any {
    if (this.mediaPlayerPromise) {
      return this.mediaPlayerPromise;
    }

    this.console.log('attempting to join session2');
    return this.mediaPlayerPromise = this.connectClient()
      .then(client => {
        this.console.log('attempting to join session');
        return new Promise((resolve, reject) => {
          client.getSessions((err, applications) => {
            if (err) {
              reject(err);
              return;
            }

            if (!applications || !applications.length) {
              this.mediaPlayerStatus = undefined;
              this.updateState();
              reject(new Error('Media player is inactive.'));
              return;
            }
            client.join(applications[0], DefaultMediaReceiver, (err, player) => {
              if (err) {
                reject(err);
                return;
              }

              player.on('close', () => {
                this.console.log('player closed');
                player.removeAllListeners();
                this.mediaPlayerPromise = undefined;
                this.mediaPlayerStatus = undefined;
                this.updateState();
              });

              player.on('status', () => {
                player.getStatus((err, status) => {
                  if (err) {
                    return;
                  }
                  this.mediaPlayerStatus = status;
                  this.updateState();
                });
              })

              resolve(player);
            });
          });
        });
      })
      .catch(e => {
        this.console.error(`Error connecting to current session ${e}`);
        this.mediaPlayerPromise = undefined;
        throw e;
      })
  }

  async start() {
    const player = await this.joinPlayer();
    player.start();
  }
  async pause() {
    const player = await this.joinPlayer();
    player.pause();
  }
  parseState(): MediaPlayerState {
    if (!this.mediaPlayerStatus) {
      return MediaPlayerState.Idle;
    }
    switch (this.mediaPlayerStatus.playerState) {
      case "PLAYING":
        return MediaPlayerState.Playing;
      case "PAUSED":
        return MediaPlayerState.Paused;
      case "IDLE":
        return MediaPlayerState.Idle;
      case "BUFFERING":
        return MediaPlayerState.Buffering;
    }
  }

  stateTimestamp: number;
  updateState() {
    this.stateTimestamp = Date.now();
    const mediaPlayerStatus = this.getMediaStatusInternal();
    switch (mediaPlayerStatus.mediaPlayerState) {
      case MediaPlayerState.Idle:
        this.running = false;
        break;
      case MediaPlayerState.Paused:
      case MediaPlayerState.Buffering:
      case MediaPlayerState.Playing:
      default:
        this.running = true;
        break;
    }
    this.paused = mediaPlayerStatus.mediaPlayerState === MediaPlayerState.Paused;
    deviceManager.onDeviceEvent(this.nativeId, ScryptedInterface.MediaPlayer, mediaPlayerStatus);
  }
  async getMediaStatus() {
    return this.getMediaStatusInternal();
  }
  getMediaStatusInternal(): MediaStatus {
    const mediaPlayerState: MediaPlayerState = this.parseState();
    const media = this.mediaPlayerStatus && this.mediaPlayerStatus.media;
    const metadata = media && media.metadata;
    let position = this.mediaPlayerStatus && this.mediaPlayerStatus.currentTime;
    if (position) {
      position += (Date.now() - this.stateTimestamp) / 1000;
    }
    return {
      mediaPlayerState,
      duration: media && media.duration,
      position,
      metadata,
    };
  }
  async seek(milliseconds: number) {
    const player = await this.joinPlayer();
    player.seek(milliseconds);
  }
  async resume() {
    const player = await this.joinPlayer();
    player.play();
  }
  async stop() {
    const player = await this.joinPlayer();
    // this would disconnect and leave it in a launched but idle state
    // player.stop();

    // this returns to the homescreen
    const client = await this.clientPromise;
    client.stop(player, () => console.log('stpoped'));
    this.clientPromise = null;
  }
  async skipNext() {
    const player = await this.joinPlayer();
    player.media.sessionRequest({ type: 'QUEUE_NEXT' });
  }
  async skipPrevious() {
    const player = await this.joinPlayer();
    player.media.sessionRequest({ type: 'QUEUE_PREV' });
  }

  async getRefreshFrequency(): Promise<number> {
    return 60;
  }
  async refresh(refreshInterface: string, userInitiated: boolean) {
    this.joinPlayer()
      .catch(() => { });
  }
}

class CastDeviceProvider extends ScryptedDeviceBase implements DeviceProvider {
  devices = new Map<string, CastDevice>();
  search = new EventEmitter();
  browser = mdns()
  searching: boolean;

  constructor() {
    super(null);

    endpointManager.setAccessControlAllowOrigin({
      origins: [
        // chromecast receiver
        'https://koush.github.io',
      ],
    });

    this.browser.on('response', response => {
      for (const additional of response.additionals) {
        if (additional.name.endsWith('_googlecast._tcp.local') && additional.type === 'TXT') {
          const txt = new Map<string, string>();
          for (const d of additional.data as any) {
            const parts = d.toString().split('=');
            txt.set(parts[0], parts[1]);
          }

          const id = txt.get('id');
          if (!id) {
            // wtf?
            return;
          }

          const model = txt.get('md');
          const name = txt.get('fn');;

          const service = response.additionals.find(check => check.type === 'SRV' && check.name === additional.name);
          if (!service) {
            console.warn('no SRV found for', additional.name);
            continue;
          }
          const host = (service.data as any).target;
          let arec = response.additionals.find(check => check.name === host && check.type === 'A');
          if (!arec)
            arec = response.additionals.find(check => check.name === host && check.type === 'AAAA');
          if (!arec) {
            console.warn('no A/AAAA record found for', additional.name);
            continue;
          }
          const ip = arec.data as string;
          const port = (service.data as any).port;

          if (this.devices.has(id)) {
            const castDevice = this.devices.get(id);
            castDevice.storage.setItem('host', ip);
            return;
          }

          this.onDiscover(id, name, model, ip, port);
        }
      }
    })

    this.discoverDevices(30000);
  }

  async onDiscover(id: string, name: string, model: string, ip: string, port: number) {

    const interfaces = [
      ScryptedInterface.MediaPlayer,
      ScryptedInterface.Refresh,
      ScryptedInterface.StartStop,
      ScryptedInterface.Pause,
      ScryptedInterface.EngineIOHandler,
      ScryptedInterface.RTCSignalingClient,
    ];

    const type = (model && model.indexOf('Google Home') !== -1 && model.indexOf('Hub') == -1)
      ? ScryptedDeviceType.Speaker
      : ScryptedDeviceType.Display;

    const device: Device = {
      nativeId: id,
      name,
      info: {
        model,
      },
      type,
      interfaces,
    };

    console.log(`found cast device: ${name}`);

    this.search.emit(id);
    await deviceManager.onDeviceDiscovered(device);

    const castDevice = await this.getDevice(id);
    castDevice.storage.setItem('host', ip);
  }

  async getDevice(nativeId: string) {
    let ret = this.devices.get(nativeId);
    if (!ret) {
      ret = new CastDevice(this, nativeId);
      this.devices.set(nativeId, ret);
    }
    return ret;
  }

  async releaseDevice(id: string, nativeId: string): Promise<void> {

  }

  async discoverDevices(duration: number) {
    if (this.searching) {
      return;
    }
    this.searching = true;
    duration = duration || 10000;

    for (let i = 0; i < 6; i++) {
      setTimeout(() => {
        this.browser.query([
          {
            type: 'PTR',
            name: '_googlecast._tcp.local'
          }
        ]);
      }, i * 10000)
    }
  }
}


export default new CastDeviceProvider();