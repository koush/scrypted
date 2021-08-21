import sdk, { DeviceManifest, DeviceProvider, HumiditySensor, OauthClient, Refresh, ScryptedDeviceType, ScryptedInterface, Setting, Settings, TemperatureSetting, TemperatureUnit, Thermometer, ThermostatMode } from '@scrypted/sdk';
import { ScryptedDeviceBase } from '@scrypted/sdk';
import qs from 'query-string';
import ClientOAuth2 from 'client-oauth2';
import { URL } from 'url';
import axios, { AxiosPromise } from 'axios';
import throttle from 'lodash/throttle';

const { mediaManager, deviceManager } = sdk;


const client_id = '827888101440-6jsq0saim1fh1abo6bmd9qlhslemok2t.apps.googleusercontent.com';
const project_id = '778da527-9690-4368-9c96-6872bb29e7a0';
const authorizationUri = `https://nestservices.google.com/partnerconnections/${project_id}/auth`
const client = new ClientOAuth2({
    clientId: client_id,
    clientSecret: 'nXgrebmaHNvZrKV7UDJV3hmg',
    accessTokenUri: 'https://www.googleapis.com/oauth2/v4/token',
    authorizationUri,
    scopes: [
        'https://www.googleapis.com/auth/sdm.service',
    ]
});

const refreshFrequency = 20;

function fromNestMode(mode: string): ThermostatMode {
    switch (mode) {
        case 'HEAT':
            return ThermostatMode.Heat;
        case 'COOL':
            return ThermostatMode.Cool;
        case 'HEATCOOL':
            return ThermostatMode.HeatCool;
        case 'OFF':
            return ThermostatMode.Off;
    }
}
function toNestMode(mode: ThermostatMode): string {
    switch (mode) {
        case ThermostatMode.Heat:
            return 'HEAT';
        case ThermostatMode.Cool:
            return 'COOL';
        case ThermostatMode.HeatCool:
            return 'HEATCOOL';
        case ThermostatMode.Off:
            return 'OFF';
    }
}

class NestThermostat extends ScryptedDeviceBase implements HumiditySensor, Thermometer, TemperatureSetting, Settings, Refresh {
    device: any;
    provider: GoogleSmartDeviceAccess;
    executeParams: any = {};

    executeThrottle = throttle(() => {
        const params = this.executeParams;
        this.executeParams = {};
        return this.provider.authPost(`/devices/${this.nativeId}:executeCommand`, {
            command : "sdm.devices.commands.ThermostatMode.SetMode",
            params,
        });
    }, 6000)

    constructor(provider: GoogleSmartDeviceAccess, device: any) {
        super(device.name.split('/').pop());
        this.provider = provider;
        this.device = device;

        this.reload();
    }

    reload() {
        const device = this.device;

        const modes: ThermostatMode[] = [];
        for (const mode of device.traits['sdm.devices.traits.ThermostatMode'].availableModes) {
            const nest = fromNestMode(mode);
            if (nest)
                modes.push(nest);
            else
                console.warn('unknown mode', mode);

        }
        this.thermostatAvailableModes = modes;
        this.thermostatMode = fromNestMode(device.traits['sdm.devices.traits.ThermostatMode'].mode);
        this.temperature = device.traits['sdm.devices.traits.Temperature'].ambientTemperatureCelsius;
        this.humidity = device.traits["sdm.devices.traits.Humidity"].ambientHumidityPercent;
        this.temperatureUnit = device.traits['sdm.devices.traits.Settings'] === 'FAHRENHEIT' ? TemperatureUnit.F : TemperatureUnit.C;
        const heat = device.traits?.['sdm.devices.traits.ThermostatTemperatureSetpoint']?.heatCelsius;
        const cool = device.traits?.['sdm.devices.traits.ThermostatTemperatureSetpoint']?.coolCelsius;

        if (this.thermostatMode === ThermostatMode.Heat) {
            this.thermostatSetpoint = heat;
            this.thermostatSetpointHigh = undefined;
            this.thermostatSetpointLow = undefined;
        }
        else if (this.thermostatMode === ThermostatMode.Cool) {
            this.thermostatSetpoint = cool;
            this.thermostatSetpointHigh = undefined;
            this.thermostatSetpointLow = undefined;
        }
        else if (this.thermostatMode === ThermostatMode.HeatCool) {
            this.thermostatSetpoint = undefined;
            this.thermostatSetpointHigh = heat;
            this.thermostatSetpointLow = cool;
        }
        else {
            this.thermostatSetpoint = undefined;
            this.thermostatSetpointHigh = undefined;
            this.thermostatSetpointLow = undefined;
        }
    }

    async refresh(refreshInterface: string, userInitiated: boolean): Promise<void> {
        const data = await this.provider.refresh();
        const device = data.devices.find(device => device.name.split('/').pop() === this.nativeId);
        if (!device)
            throw new Error('device missing from device list on refresh');
        this.device = device;
        this.reload();
    }

    async getRefreshFrequency(): Promise<number> {
        return refreshFrequency;
    }

    async getSettings(): Promise<Setting[]> {
        const ret: Setting[] = [];
        for (const key of Object.keys(this.device.traits['sdm.devices.traits.Settings'])) {
            ret.push({
                title: key,
                value: this.device.traits['sdm.devices.traits.Settings'][key],
                readonly: true,
            });
        }
        return ret;
    }
    async putSetting(key: string, value: string | number | boolean): Promise<void> {
    }
    async setThermostatMode(mode: ThermostatMode): Promise<void> {
        this.executeParams.mode = toNestMode(mode);
        await this.executeThrottle();
        await this.refresh(null, true);
    }
    async setThermostatSetpoint(degrees: number): Promise<void> {
        this.executeParams.heatCelsius = degrees;
        this.executeParams.coolCelsius = degrees;
        await this.executeThrottle();
        await this.refresh(null, true);
    }
    async setThermostatSetpointHigh(high: number): Promise<void> {
        this.executeParams.heatCelsius = high;
        await this.executeThrottle();
        await this.refresh(null, true);
    }
    async setThermostatSetpointLow(low: number): Promise<void> {
        this.executeParams.coolCelsius = low;
        await this.executeThrottle();
        await this.refresh(null, true);
    }
}

class GoogleSmartDeviceAccess extends ScryptedDeviceBase implements OauthClient, DeviceProvider {
    token: ClientOAuth2.Token;
    devices = new Map<string, any>();
    refreshThrottled = throttle(async () => {
        const response = await this.authGet('/devices');
        return response.data;
    }, refreshFrequency * 10000);

    constructor() {
        super();
        this.discoverDevices(0).catch(() => { });
    }

    async loadToken() {
        try {
            if (!this.token) {
                this.token = client.createToken(JSON.parse(localStorage.getItem('token')));
                this.token.expiresIn(-1000);
            }
        }
        catch (e) {
            this.log.a('Missing token. Please log in.');
            throw new Error('Missing token. Please log in.');
        }
        if (this.token.expired()) {
            this.token = await this.token.refresh();
            this.saveToken();
        }
    }

    saveToken() {
        localStorage.setItem('token', JSON.stringify(this.token.data));
    }

    async refresh(): Promise<any> {
        return this.refreshThrottled();
    }

    async getOauthUrl(): Promise<string> {
        const params = {
            client_id,
            access_type: 'offline',
            prompt: 'consent',
            response_type: 'code',
            scope: 'https://www.googleapis.com/auth/sdm.service',
        }
        return `${authorizationUri}?${qs.stringify(params)}`;
    }
    async onOauthCallback(callbackUrl: string) {
        const cb = new URL(callbackUrl);
        cb.search = '';
        const redirectUri = cb.toString();
        this.token = await client.code.getToken(callbackUrl, {
            redirectUri,
        });
        this.saveToken();

        this.discoverDevices(0).catch(() => { });
    }

    async authGet(path: string): Promise<any> {
        await this.loadToken();
        return axios(`https://smartdevicemanagement.googleapis.com/v1/enterprises/${project_id}${path}`, {
            headers: {
                Authorization: `Bearer ${this.token.accessToken}`
            }
        });
    }

    async authPost(path: string, data: any): Promise<any> {
        await this.loadToken();
        return axios.post(`https://smartdevicemanagement.googleapis.com/v1/enterprises/${project_id}${path}`, data, {
            headers: {
                Authorization: `Bearer ${this.token.accessToken}`
            }
        });
    }

    async discoverDevices(duration: number): Promise<void> {
        let data: any;
        while (true) {
            try {
                data = await this.refresh();
                break;
            }
            catch (e) {
                console.error(e);
            }
        }

        // const structuresResponse = await this.authGet('/structures');

        const deviceManifest: DeviceManifest = {
            devices: [],
        };
        this.devices.clear();
        for (const device of data.devices) {
            const nativeId = device.name.split('/').pop();
            if (device.type === 'sdm.devices.types.THERMOSTAT') {
                this.devices.set(nativeId, device);

                deviceManifest.devices.push({
                    name: device.traits?.['sdm.devices.traits.Info']?.customName || device.parentRelations?.[0]?.displayName,
                    nativeId: nativeId,
                    type: ScryptedDeviceType.Thermostat,
                    interfaces: [
                        ScryptedInterface.Refresh,
                        ScryptedInterface.TemperatureSetting,
                        ScryptedInterface.HumiditySensor,
                        ScryptedInterface.Thermometer,
                        ScryptedInterface.Settings]
                })
            }
        }

        deviceManager.onDevicesChanged(deviceManifest);
    }

    getDevice(nativeId: string) {
        const device = this.devices.get(nativeId);
        if (!device)
            return;
        if (device.type === 'sdm.devices.types.THERMOSTAT') {
            return new NestThermostat(this, device);
        }
    }
}

export default new GoogleSmartDeviceAccess();
