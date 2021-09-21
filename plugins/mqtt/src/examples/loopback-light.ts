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
mqtt.handle<OnOff & Brightness>({
    turnOff: () => mqtt.publish('/light/set', { on: false }),
    turnOn: () => mqtt.publish('/light/set', { on: true }),
    setBrightness: brightness => mqtt.publish('/brightness/set', { brightness }),
});
