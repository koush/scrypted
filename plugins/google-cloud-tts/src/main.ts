// https://developer.scrypted.app/#getting-started
import axios from 'axios';
import sdk, { BufferConverter, ScryptedDeviceBase, Settings, Setting } from "@scrypted/sdk";

class GoogleCloudTts extends ScryptedDeviceBase implements BufferConverter, Settings {
  constructor() {
    super();
    this.fromMimeType = 'text/plain';
    this.toMimeType = 'audio/mpeg';

    if (!this.getApiKey())
      this.log.a('API key missing.');
  }
  getApiKey() {
    const apiKey = this.storage.getItem('api_key');
    return apiKey;
  }
  async convert(data: string | Buffer, fromMimeType: string): Promise<Buffer> {
    const voice_name = this.storage.getItem("voice_name") || "en-GB-Standard-A";
    const voice_gender = this.storage.getItem("voice_gender") || "FEMALE";
    const voice_language_code = this.storage.getItem("voice_language_code") || "en-GB";

    const from = Buffer.from(data);
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

    var result = await axios.post(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${this.getApiKey()}`, json);
    console.log(JSON.stringify(result.data, null, 2));
    const buffer = Buffer.from(result.data.audioContent, 'base64');
    return buffer;
  }

  voices: any;
  async getSettings(): Promise<Setting[]> {
    const ret: Setting[] = [
      {
        title: 'API Key',
        description: 'API Key used by Google Cloud TTS.',
        key: 'api_key',
        value: this.storage.getItem('api_key'),
      }
    ];

    if (!this.getApiKey())
      return ret;

    try {
      if (!this.voices) {
        const response = await axios.get(`https://texttospeech.googleapis.com/v1/voices?key=${this.getApiKey()}`)
        this.voices = response.data;
      }

    }
    catch (e) {
      this.log.a('Error retrieving settings from Google Cloud Text to Speech. Is your API Key correct?');
      return ret;
    }
    ret.push({
      title: "Voice",
      choices: this.voices.voices.map(voice => voice.name),
      key: "voice",
      value: this.storage.getItem("voice_name"),
    });
    return ret;
  }
  async putSetting(key: string, value: string | number | boolean) {
    if (key !== 'voice') {
      this.storage.setItem(key, value.toString());
      return;
    }

    const found = this.voices.voices.find((voice: any) => voice.name === value);
    if (!found) {
      console.error('Voice not found.');
      return;
    }

    localStorage.setItem('voice_name', found.name);
    localStorage.setItem('voice_language_code', found.languageCodes[0]);
    localStorage.setItem('voice_gender', found.ssmlGender);
  }
}

export default new GoogleCloudTts();
