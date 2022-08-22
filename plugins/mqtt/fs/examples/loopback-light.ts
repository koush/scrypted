import { ScriptDevice } from "@scrypted/common/src/eval/monaco/script-device"; // SCRYPTED_FILTER_EXAMPLE_LINE
import { OnOff, Brightness, ScryptedDeviceBase } from "@scrypted/sdk"; // SCRYPTED_FILTER_EXAMPLE_LINE
import { MqttClient, MqttEvent } from "../../src/api/mqtt-client"; // SCRYPTED_FILTER_EXAMPLE_LINE
declare const device: ScriptDevice & ScryptedDeviceBase; // SCRYPTED_FILTER_EXAMPLE_LINE
declare const mqtt: MqttClient; // SCRYPTED_FILTER_EXAMPLE_LINE

/**
 * This is an example of a loopback light device.
 * Turning the light on or off will publish a set command on the MQTT broker.
 * This command will update the status on the MQTT broker.
 * The status update will then be reported back to Scrpyted and will update the device state.
 * View the Console and the Logs to watch it in action.
 */
mqtt.subscribe({
    // watch for set commands on the server, and publish status updates
    '/brightness/set': value => updateStatus(value),
    '/light/set': value => updateStatus(value),

    // status updates from the server update the status on Scrypted
    '/status': value => {
        device.on = value.json.on;
        device.brightness = value.json.brightness;
    },
});

function updateStatus(value: MqttEvent) {
    mqtt.publish('/status', Object.assign({}, {
        on: device.on,
        brightness: device.brightness,
    }, value.json));
}

/**
 * Commands from Scrypted (via the web dashboard, HomeKit, Google Home, etc)
 *  get handled here and sent to the MQTT broker.
 */
export default {
    turnOff: () => mqtt.publish('/light/set', { on: false }),
    turnOn: () => mqtt.publish('/light/set', { on: true }),
    setBrightness: brightness => mqtt.publish('/brightness/set', { brightness }),
} as OnOff & Brightness;
