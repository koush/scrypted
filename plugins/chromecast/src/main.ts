'use strict';

import util from 'util';
import sdk, { Device, DeviceProvider, EngineIOHandler, HttpRequest, MediaObject, MediaPlayer, MediaPlayerOptions, MediaPlayerState, MediaStatus, Refresh, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes } from '@scrypted/sdk';
import { EventEmitter } from 'events';
import mdns from 'mdns';
import mime from 'mime';

const { mediaManager, systemManager, endpointManager, deviceManager, log } = sdk;
const { DefaultMediaReceiver } = require('castv2-client');
const Client = require('castv2-client').Client;

function ScryptedMediaReceiver() {
  DefaultMediaReceiver.apply(this, arguments);
}
ScryptedMediaReceiver.APP_ID = '00F7C5DD';
util.inherits(ScryptedMediaReceiver, DefaultMediaReceiver);

// castv2 makes the the assumption that protobufjs returns Buffers, which is does not. It returns ArrayBuffers
// in the quickjs environment.
function toBuffer(buffer) {
  if (buffer && (buffer.constructor.name === ArrayBuffer.name || buffer.constructor.name === Uint8Array.name)) {
    var ret = Buffer.from(buffer);
    return ret;
  }
  return buffer;
}
const BufferConcat = Buffer.concat;
Buffer.concat = function (bufs) {
  var copy = [];
  for (var buf of bufs) {
    copy.push(toBuffer(buf));
  }
  return BufferConcat(copy);
}

class CastDevice extends ScryptedDeviceBase implements MediaPlayer, Refresh, EngineIOHandler {
  provider: CastDeviceProvider;
  host: any;
  device: Device;
  port: number;

  constructor(provider: CastDeviceProvider, nativeId: string) {
    super(nativeId);
    this.provider = provider;
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
          this.log.i('launching');
          client.launch(app, (err, player) => {
            if (err) {
              reject(err);
              return;
            }

            player.on('close', () => {
              this.log.i('player closed');
              player.removeAllListeners();
              this.playerPromise = undefined;
            });

            this.log.i('player launched.');
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

    var promise;
    return this.clientPromise = promise = new Promise((resolve, reject) => {
      var client = new Client();

      const cleanup = () => {
        client.removeAllListeners();
        client.close();
        if (this.clientPromise === promise) {
          this.clientPromise = undefined;
        }
      }
      client.on('close', cleanup);
      client.on('error', err => {
        this.log.i(`Client error: ${err.message}`);
        cleanup();
        reject(err);
      });
      client.on('status', async status => {
        this.log.i(JSON.stringify(status));
        try {
          await this.joinPlayer();
        }
        catch (e) {
        }
      })
      client.connect(this.host, () => {
        this.log.i(`client connected.`);
        resolve(client);
      });
    })
  }

  tokens = new Map<string, MediaObject>();

  async sendMediaToClient(title: string, mediaUrl: string, mimeType: string, opts?: any) {
    var media: any = {
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
        this.log.e(`load error: ${err}`);
        return;
      }
      this.log.i(`media loaded playerState=${status.playerState}`);
    });
  }

  async load(media: string|MediaObject, options: MediaPlayerOptions) {
    // check to see if this is url friendly media.
    if (typeof media === 'string')
      media = mediaManager.createMediaObject(media, ScryptedMimeTypes.Url);

    if (media.mimeType === ScryptedMimeTypes.LocalUrl ||
      media.mimeType === ScryptedMimeTypes.InsecureLocalUrl ||
      media.mimeType === ScryptedMimeTypes.Url ||
      media.mimeType.startsWith('image/') ||
      media.mimeType.startsWith('video/')) {

      // chromecast can handle insecure local urls, but not self signed secure urls.
      const url = media.mimeType === ScryptedMimeTypes.InsecureLocalUrl || media.mimeType === ScryptedMimeTypes.LocalUrl
        ? await mediaManager.convertMediaObjectToInsecureLocalUrl(media, media.mimeType)
        : await mediaManager.convertMediaObjectToUrl(media, media.mimeType);
      this.sendMediaToClient(options && (options as any).title,
        url,
        // prefer the provided mime type hint, otherwise infer from url.
        options.mimeType || mime.getType(url));
      return;
    }

    // this media object is something weird that can't be handled by a straightforward url.
    // try to make a webrtc a/v session to handle it.

    const engineio = await endpointManager.getPublicLocalEndpoint(this.nativeId) + 'engine.io/';
    const mo = mediaManager.createMediaObject(engineio, ScryptedMimeTypes.LocalUrl);
    const cameraStreamAuthToken = await mediaManager.convertMediaObjectToUrl(mo, ScryptedMimeTypes.LocalUrl);
    const token = Math.random().toString();
    this.tokens.set(token, media);

    var castMedia: any = {
      contentId: cameraStreamAuthToken,
      contentType: ScryptedMimeTypes.LocalUrl,
      streamType: 'LIVE',

      // Title and cover displayed while buffering
      metadata: {
        type: 0,
        metadataType: 0,
        title: options?.title || 'Scrypted',
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
        this.log.e(`load error: ${err}`);
        return;
      }
      this.log.i(`media loaded playerState=${status.playerState}`);
    });
  }


  async onConnection(request: HttpRequest, webSocketUrl: string) {
    const ws = new WebSocket(webSocketUrl);

    ws.onmessage = async (message) => {
      const token = message.data as string;

      const media = this.tokens.get(token);
      if (!media) {
        ws.close();
        return;
      }

      const offer = await mediaManager.convertMediaObjectToBuffer(
        media,
        ScryptedMimeTypes.RTCAVOffer
      );

      ws.send(offer.toString());

      const answer = await new Promise(resolve => ws.onmessage = (message) => resolve(message.data));
      const mo = mediaManager.createMediaObject(Buffer.from(answer as string), ScryptedMimeTypes.RTCAVAnswer);
      mediaManager.convertMediaObjectToBuffer(mo, ScryptedMimeTypes.RTCAVOffer);
    }
  }


  mediaPlayerPromise: Promise<any>;
  mediaPlayerStatus: any;
  joinPlayer() {
    if (this.mediaPlayerPromise) {
      return this.mediaPlayerPromise;
    }

    this.log.i('attempting to join session2');
    return this.mediaPlayerPromise = this.connectClient()
      .then(client => {
        this.log.i('attempting to join session');
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
                this.log.i('player closed');
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

              player.getStatus((err, status) => {
                if (err) {
                  reject(err);
                  return;
                }
                this.mediaPlayerStatus = status;
                this.updateState();
                resolve(player);
              })
            });
          });
        });
      })
      .catch(e => {
        this.log.e(`Error connecting to current session ${e}`);
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
    var mediaPlayerState: MediaPlayerState = this.parseState();
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
  devices: any = {};
  search = new EventEmitter();
  browser = mdns.createBrowser(mdns.tcp('googlecast'));
  searching: boolean;

  constructor() {
    super(null);

    this.browser.on('serviceUp', (service) => {
      this.log.i(JSON.stringify(service));
      var id = service.txtRecord.id;
      if (!id) {
        // wtf?
        return;
      }
      var model = service.txtRecord.md;
      var name = service.txtRecord.fn;
      var type = (model && model.indexOf('Google Home') != -1 && model.indexOf('Hub') == -1) ? ScryptedDeviceType.Speaker : ScryptedDeviceType.Display;

      var interfaces = [
        ScryptedInterface.MediaPlayer,
        ScryptedInterface.Refresh,
        ScryptedInterface.StartStop,
        ScryptedInterface.Pause,
        ScryptedInterface.EngineIOHandler,
        ScryptedInterface.HttpRequestHandler,
      ];

      var device: Device = {
        nativeId: id,
        name,
        model,
        type,
        interfaces,
        metadata: {
          syncWithIntegrations: false,
          syncWithGoogle: false,
        },
      };

      const host = service.addresses[0];
      const port = service.port;


      this.log.i(`found cast device: ${name}`);

      var castDevice = this.devices[id] || (this.devices[id] = new CastDevice(this, device.nativeId));
      castDevice.device = device;
      castDevice.host = host;
      castDevice.port = port;

      this.search.emit(id);
      deviceManager.onDeviceDiscovered(device);
    });

    this.discoverDevices(30000);
  }

  getDevice(nativeId: string) {
    return this.devices[nativeId] || (this.devices[nativeId] = new CastDevice(this, nativeId));
  }

  async discoverDevices(duration: number) {
    if (this.searching) {
      return;
    }
    this.searching = true;
    duration = duration || 10000;
    setTimeout(() => {
      this.searching = false;
      this.browser.stop();
    }, duration)

    this.browser.start();
  }
}


export default new CastDeviceProvider();