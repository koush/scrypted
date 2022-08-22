mqtt.subscribe({
    'shellies/shellydimmer2-E8DB84D486EC/light/0/status': ({json}) => {
        device.on = json.ison;
        device.brightness = json.brightness;
    },
});

mqtt.handle<OnOff & Brightness>({
    turnOff: () => mqtt.publish('shellies/shellydimmer2-E8DB84D486EC/light/0/command', 'off'),
    turnOn: () => mqtt.publish('shellies/shellydimmer2-E8DB84D486EC/light/0/command', 'on'),
    setBrightness: brightness => mqtt.publish('shellies/shellydimmer2-E8DB84D486EC/light/0/set', { brightness }),
});
