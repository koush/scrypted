import { put, get } from "request-promise";

export class KeyLight {
    ip: string;
    port: number;
    name: string;
    settings?: KeyLightSettings;
    info?: KeyLightInfo;
    options?: KeyLightOptions;

    constructor(ip: string, port: number, name: string)
    {
        this.ip = ip;
        this.port = port;
        this.name = name;
        setImmediate(() => this.refresh());
    }

    async refresh() {
        await this.getSettings();
        await this.getInfo();
        await this.getOptions();
    }

    async getSettings() {
        let settingsCall = await get(`http://${this.ip}:${this.port}/elgato/lights/settings`);
        this.settings = await JSON.parse(settingsCall);
    }

    async getOptions() {
        let optionsCall = await get(`http://${this.ip}:${this.port}/elgato/lights`);
        this.options = await JSON.parse(optionsCall);
    }

    async getInfo() {
        let infoCall = await get(`http://${this.ip}:${this.port}/elgato/accessory-info`);
        this.info = await JSON.parse(infoCall);
    }

    async turnOn() {
        let optionsCall = await put(`http://${this.ip}:${this.port}/elgato/lights`, {
                    body: JSON.stringify({
                        "numberOfLights": 1,
                        "lights": [
                            {
                                "on": 1
                            }
                        ]
                    })
                });
        this.options = await JSON.parse(optionsCall);
    }

    async turnOff() {
        let optionsCall = await put(`http://${this.ip}:${this.port}/elgato/lights`, {
                    body: JSON.stringify({
                        "numberOfLights": 1,
                        "lights": [
                            {
                                "on": 0
                            }
                        ]
                    })
                });
        this.options = await JSON.parse(optionsCall);
    }

    async setBrightness(level: number) {
        let optionsCall = await put(`http://${this.ip}:${this.port}/elgato/lights`, {
                    body: JSON.stringify({
                        "numberOfLights": 1,
                        "lights": [
                            {
                                "brightness": level,
                            }
                        ]
                    })
                });
        this.options = await JSON.parse(optionsCall);
    }

    async setColorTemperature(kelvin: number) {
        let temperature = Math.round(987007 * Math.pow(kelvin, -0.999));
        let optionsCall = await put(`http://${this.ip}:${this.port}/elgato/lights`, {
                    body: JSON.stringify({
                        "numberOfLights": 1,
                        "lights": [
                            {
                                "temperature": temperature,
                            }
                        ]
                    })
                });
        this.options = await JSON.parse(optionsCall);
      }
}

export interface KeyLightSettings {
    powerOnBehavior: number;
    powerOnBrightness: number;
    powerOnTemperature: number;
    switchOnDurationMs: number;
    switchOffDurationMs: number;
    colorChangeDurationMs: number;
}

export interface KeyLightInfo {
    productName: string;
    hardwareBoardType: number;
    firmwareBuildNumber: number;
    firmwareVersion: string;
    serialNumber: string;
    displayName: string;
    features: Array<string>;
}

export interface KeyLightOptions {
    numberOfLights: number;
    lights: [{
        on: number;
        brightness: number;
        temperature: number;
    }];
}