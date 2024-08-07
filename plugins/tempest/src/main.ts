import sdk, { 
    DeviceProvider,
    ScryptedDeviceBase,
    Setting,
    Settings,
    SettingValue,
    ScryptedInterface,
    TemperatureUnit,
    Thermometer,
    HumiditySensor,
    BinarySensor,
    Battery
} from '@scrypted/sdk';
import axios from 'axios';

const { deviceManager } = sdk;

class TempestWeatherStation extends ScryptedDeviceBase implements 
    DeviceProvider, 
    Settings, 
    Thermometer,
    HumiditySensor,
    BinarySensor,
    Battery {

    temperature: number;
    humidity: number;
    pressure: number;
    windSpeed: number;
    windDirection: number;
    uvIndex: number;
    rainRate: number;
    solarRadiation: number;
    batteryLevel: number;
    temperatureUnit: TemperatureUnit;

    constructor(nativeId?: string) {
        super(nativeId);
        
        // Initialize properties
        this.temperature = 0;
        this.humidity = 0;
        this.pressure = 0;
        this.windSpeed = 0;
        this.windDirection = 0;
        this.uvIndex = 0;
        this.rainRate = 0;
        this.solarRadiation = 0;
        this.batteryLevel = 100;
        this.temperatureUnit = TemperatureUnit.C; // Default to Celsius

        this.updateStatus();
        this.startPeriodicUpdates();
    }

    async getSettings(): Promise<Setting[]> {
        return [
            {
                key: 'accessToken',
                title: 'Personal Access Token',
                value: this.storage.getItem('accessToken'),
                type: 'password',
            },
            {
                key: 'stationId',
                title: 'Station ID',
                value: this.storage.getItem('stationId'),
                type: 'string',
            },
        ];
    }

    async putSetting(key: string, value: SettingValue): Promise<void> {
        this.storage.setItem(key, value.toString());
        await this.updateStatus();
    }

    async updateStatus() {
        const accessToken = this.storage.getItem('accessToken');
        const stationId = this.storage.getItem('stationId');

        if (!accessToken || !stationId) {
            this.console.error('Access token or station ID not set');
            return;
        }

        try {
            const response = await axios.get(`https://swd.weatherflow.com/swd/rest/observations/station/${stationId}?token=${accessToken}`);
            const data = response.data.obs[0];

            this.temperature = data.air_temperature;
            this.humidity = data.relative_humidity;
            this.pressure = data.station_pressure;
            this.windSpeed = data.wind_avg;
            this.windDirection = data.wind_direction;
            this.uvIndex = data.uv;
            this.rainRate = data.precip;
            this.solarRadiation = data.solar_radiation;
            this.batteryLevel = data.battery * 100; // Assuming battery is reported as a decimal

            // Update Scrypted device state
            this.temperature = this.temperature;
            this.humidity = this.humidity;
            this.binaryState = this.windSpeed >= 10; // High wind alert
            this.batteryLevel = this.batteryLevel;

            // Emit events for each updated property
            this.onDeviceEvent(ScryptedInterface.Thermometer, this.temperature);
            this.onDeviceEvent(ScryptedInterface.HumiditySensor, this.humidity);
            this.onDeviceEvent(ScryptedInterface.BinarySensor, this.binaryState);
            this.onDeviceEvent(ScryptedInterface.Battery, this.batteryLevel);

            this.console.log('Weather data updated:', data);
        } catch (error) {
            this.console.error('Error fetching weather data:', error);
        }
    }

    startPeriodicUpdates(intervalMinutes: number = 5) {
        setInterval(() => this.updateStatus(), intervalMinutes * 60 * 1000);
    }

    async getDevice(nativeId: string): Promise<any> {
        return Promise.resolve(this);
    }

    async releaseDevice(id: string, nativeId: string): Promise<void> {
        // Not needed for this single-device plugin
        return Promise.resolve();
    }

    // Implement methods required by Thermometer interface
    async getTemperatureUnit(): Promise<TemperatureUnit> {
        return this.temperatureUnit;
    }

    async setTemperatureUnit(unit: TemperatureUnit): Promise<void> {
        this.temperatureUnit = unit;
        // You might want to save this preference to storage
        this.storage.setItem('temperatureUnit', unit);
    }
}

export default new TempestWeatherStation();