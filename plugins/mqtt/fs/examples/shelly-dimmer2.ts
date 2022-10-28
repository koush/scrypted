import { ScriptDevice } from "@scrypted/common/src/eval/monaco/script-device"; // SCRYPTED_FILTER_EXAMPLE_LINE
import { Brightness, OnOff, ScryptedDeviceBase } from "@scrypted/sdk"; // SCRYPTED_FILTER_EXAMPLE_LINE
import { MqttClient } from "../../src/api/mqtt-client"; // SCRYPTED_FILTER_EXAMPLE_LINE
declare const device: ScriptDevice & ScryptedDeviceBase; // SCRYPTED_FILTER_EXAMPLE_LINE
declare const mqtt: MqttClient; // SCRYPTED_FILTER_EXAMPLE_LINE

mqtt.subscribe({
    'shellies/shellydimmer2-E8DB84D486EC/light/0/status': ({ json }) => {
        device.on = json.ison;
        device.brightness = json.brightness;
    },
});

export default {
    turnOff: () => mqtt.publish('shellies/shellydimmer2-E8DB84D486EC/light/0/command', 'off'),
    turnOn: () => mqtt.publish('shellies/shellydimmer2-E8DB84D486EC/light/0/command', 'on'),
    setBrightness: brightness => mqtt.publish('shellies/shellydimmer2-E8DB84D486EC/light/0/set', { brightness }),
} as OnOff & Brightness;
