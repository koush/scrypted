import axios from 'axios';

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
        const { data, status } = await axios.get<KeyLightSettings>(`http://${this.ip}:${this.port}/elgato/lights/settings`);
        this.settings = data;
    }

    async getOptions() {
        const { data, status } = await axios.get<KeyLightOptions>(`http://${this.ip}:${this.port}/elgato/lights`);
        this.options = data;
    }

    async getInfo() {
        const { data, status } = await axios.get<KeyLightInfo>(`http://${this.ip}:${this.port}/elgato/accessory-info`);
        this.info = data;
    }

    async turnOn() {
        const { data } = await axios.put<KeyLightOptions>(
            `http://${this.ip}:${this.port}/elgato/lights`, 
            {
                "numberOfLights": 1,
                "lights": [
                    {
                        "on": 1
                    }
                ]
            }
        );
        this.options = data;
    }

    async turnOff() {
        const { data } = await axios.put<KeyLightOptions>(
            `http://${this.ip}:${this.port}/elgato/lights`, 
            {
                "numberOfLights": 1,
                "lights": [
                    {
                        "on": 0
                    }
                ]
            }
        );
        this.options = data;
    }

    async setBrightness(level: number) {
        const { data } = await axios.put<KeyLightOptions>(
            `http://${this.ip}:${this.port}/elgato/lights`, 
            {
                "numberOfLights": 1,
                "lights": [
                    {
                        "brightness": level,
                    }
                ]
            }
        );
        this.options = data;
    }

    async setColorTemperature(temperature: number) {
        const { data } = await axios.put<KeyLightOptions>(
            `http://${this.ip}:${this.port}/elgato/lights`, 
            {
                "numberOfLights": 1,
                "lights": [
                    {
                        "temperature": temperature,
                    }
                ]
            }
        );
        this.options = data;
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