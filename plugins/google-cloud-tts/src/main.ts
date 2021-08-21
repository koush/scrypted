// https://developer.scrypted.app/#getting-started
import axios from 'axios';
import sdk, { BufferConverter, ScryptedDeviceBase, Settings, Setting } from "@scrypted/sdk";
import { Buffer } from 'buffer';
const { log } = sdk;

const api_key = localStorage.getItem('api_key');

function alertAndThrow(msg) {
  log.a(msg);
  throw new Error(msg);
}

if (!api_key) {
  alertAndThrow('The "api_key" Script Setting values is missing.');
}
log.clearAlerts();


var voice_name = localStorage.getItem("voice_name");
if (!voice_name) {
  voice_name = "en-GB-Standard-A";
  log.i(`Using default voice_name setting: ${voice_name}. See settings for more information.`);
}

var voice_gender = localStorage.getItem("voice_gender");
if (!voice_gender) {
  voice_gender = "FEMALE";
  log.i(`Using default voice_gender setting: ${voice_gender}. See settings for more information.`);
}

var voice_language_code = localStorage.getItem("voice_language_code");
if (!voice_language_code) {
  voice_language_code = "en-GB";
  log.i(`Using default voice_language_code setting: ${voice_language_code}. See settings for more information.`);
}

var voices: any = {};
axios.get(`https://texttospeech.googleapis.com/v1/voices?key=${api_key}`)
  .then(response => {
    log.i(JSON.stringify(response.data, null, 2));
    voices = response.data;
  });


class Device extends ScryptedDeviceBase implements BufferConverter, Settings {
  constructor() {
    super();
    this.fromMimeType = 'text/plain';
    this.toMimeType = 'audio/mpeg';
  }
  async convert(from, fromMimeType) {
    log.i(from.toString());
    from = Buffer.from(from);
    var json = {
      "input": {
        "text": from.toString()
      },
      "voice": {
        "languageCode": voice_language_code,
        "name": voice_name,
        "ssmlGender": voice_gender
      },
      "audioConfig": {
        "audioEncoding": "MP3"
      }
    };
    log.i(JSON.stringify(json));

    var result = await axios.post(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${api_key}`, json);
    log.i(JSON.stringify(result.data, null, 2));
    const buffer = Buffer.from(result.data.audioContent, 'base64');
    return buffer;
  }

  async getSettings(): Promise<Setting[]> {
    return [{
      title: "Voice",
      choices: voices.voices.map(voice => voice.name),
      key: "voice",
      value: voice_name,
    }];
  }
  putSetting(key: string, value: string | number | boolean): void {
    if (key !== 'voice') {
      return;
    }

    var found = voices.voices.find(voice => voice.name === value);
    if (!found) {
      log.a('Voice not found.');
      return;
    }

    voice_name = found.name;
    voice_language_code = found.languageCodes[0];
    voice_gender = found.ssmlGender;
    localStorage.setItem('voice_name', voice_name);
    localStorage.setItem('voice_language_code', voice_language_code);
    localStorage.setItem('voice_gender', voice_gender);
  }
}

export default new Device();
