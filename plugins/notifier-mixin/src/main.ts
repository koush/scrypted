
import { MixinProvider, Notifier, ScryptedDevice, MixinDeviceBase, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, MediaObject, MediaPlayer } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import memoizeOne from 'memoize-one';

const { mediaManager, log } = sdk;

async function audioFetch(body: string): Promise<string> {
  const buf = Buffer.from(body);
  const mo = mediaManager.createMediaObject(buf, 'text/plain');
  return mediaManager.convertMediaObjectToInsecureLocalUrl(mo, 'audio/*');
}

// memoize this text conversion, as announcements going to multiple speakers will
// trigger multiple text to speech conversions.
// this is a simple way to prevent thrashing by waiting for the single promise.
var memoizedAudioFetch = memoizeOne(audioFetch);

class NotifierMixin extends MixinDeviceBase<MediaPlayer> implements Notifier {
  constructor(mixinDevice: MediaPlayer, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any }, mixinProviderNativeId: string) {
    super({mixinDevice, mixinDeviceInterfaces, mixinDeviceState, mixinProviderNativeId});
  }

  async sendNotification(title: string, body: string, media: string | MediaObject, mimeType: string): Promise<void> {
    if (!media || this.type == 'Speaker') {
      try {
        log.i('fetching audio: ' + body);
        const result = await memoizedAudioFetch(body)
        log.i(`sending audio ${result}`);
        (this.mixinDevice as MediaPlayer).load(result, {
          title,
        })
      }
      catch (e) {
        log.e(`error memoizing audio ${e}`);
        // do not cache errors.
        memoizedAudioFetch = memoizeOne(audioFetch);
      }
      return;
    }

    (this.mixinDevice as MediaPlayer).load(media, {
      title,
      mimeType,
    });
  }
}

class NotifierProvider extends ScryptedDeviceBase implements MixinProvider {
  async releaseMixin(id: string, mixinDevice: any) {
  }
  async canMixin(type: ScryptedDeviceType, interfaces: string[]) {
    if (!interfaces.includes(ScryptedInterface.MediaPlayer))
      return null;
    return [ScryptedInterface.Notifier];
  }

  async getMixin(mixinDevice: MediaPlayer, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any }) {
    return new NotifierMixin(mixinDevice, mixinDeviceInterfaces, mixinDeviceState, this.nativeId);
  }
}

export default new NotifierProvider();
