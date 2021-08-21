
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

class NotifierMixin extends MixinDeviceBase implements Notifier {
  constructor(mixinDevice: ScryptedDevice, deviceState: any) {
    super(mixinDevice, deviceState);
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
  canMixin(type: ScryptedDeviceType, interfaces: string[]): string[] {
    if (!interfaces.includes(ScryptedInterface.MediaPlayer))
      return null;
    return [ScryptedInterface.Notifier];
  }

  getMixin(device: ScryptedDevice, deviceState: any) {
    return new NotifierMixin(device, deviceState);
  }
}

export default new NotifierProvider();
