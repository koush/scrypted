/**
 * This is an example of a loopback light device.
 * Turning the light on or off will publish a set command on the MQTT broker.
 * The subscription update will in turn update the state of the light in Scrypted.
 * View the Console and the Logs to watch it in action.
 */
mqtt.subscribe({
    // watch for set commands on the server, and publish status updates
    '/brightness/set': value => mqtt.publish('/brightness/status', value.json),
    '/light/set': value => mqtt.publish('/light/status', value.json),

    // status updates from the server update the status on Scrypted
    '/brightness/status': value => device.brightness = value.json.brightness,
    '/light/status': value => device.on = value.json.on,
});

/**
 * Commands from Scrypted (via the web dashboard, HomeKit, Google Home, etc)
 *  get handled here and sent to the MQTT broker.
 */
mqtt.handle<OnOff & Brightness>({
    async turnOff() {
        mqtt.publish('/light/set', { on: false });
    },
    async turnOn() {
        mqtt.publish('/light/set', { on: true });
    },
    async setBrightness(brightness) {
        mqtt.publish('/brightness/set', { brightness });
    }
});
