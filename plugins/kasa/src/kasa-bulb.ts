import { Brightness, ColorHsv, ColorSettingHsv, ColorSettingTemperature, OnOff, ScryptedDeviceBase, Setting, Settings, SettingValue } from '@scrypted/sdk';
import { StorageSettings } from '@scrypted/sdk/storage-settings';
import { KASA_IOT_PORT, getSysInfo, kasaIotCall } from './kasa-iot';

const STATE_POLL_INTERVAL_MS = 30000;

// Smart bulbs (LB100/110/120/130, KL110/120/130/135/...). All bulb state — on/off,
// brightness, hue, saturation, color temperature — is controlled by a single command:
//   {"smartlife.iot.smartbulb.lightingservice":{"transition_light_state":{...}}}
//
// Capability flags from sysinfo:
//   is_dimmable           1 = supports brightness
//   is_color              1 = supports hue/saturation
//   is_variable_color_temp 1 = supports color temperature
// Color temperature range is determined per-model; we expose the values the bulb returns
// in `getTemperatureMinK`/`getTemperatureMaxK` and fall back to a safe pair otherwise.
export class KasaBulb extends ScryptedDeviceBase implements OnOff, Brightness, ColorSettingHsv, ColorSettingTemperature, Settings {
    storageSettings = new StorageSettings(this, {
        ip: {
            title: 'IP Address',
            placeholder: '192.168.1.100',
        },
        port: {
            title: 'Port',
            type: 'number',
            defaultValue: KASA_IOT_PORT,
        },
        // Capability flags captured from sysinfo at adoption — internal only, drive which
        // interfaces the device advertises. Hidden because users don't typically need to
        // toggle them (auto-detected from the bulb's own metadata).
        isColor: {
            type: 'boolean',
            hide: true,
        },
        isVariableColorTemp: {
            type: 'boolean',
            hide: true,
        },
        colorTemperatureMinK: {
            type: 'number',
            defaultValue: 2700,
            hide: true,
        },
        colorTemperatureMaxK: {
            type: 'number',
            defaultValue: 6500,
            hide: true,
        },
    });

    private pollTimer?: NodeJS.Timeout;
    private pollStartTimer?: NodeJS.Timeout;
    // See KasaIotDevice for rationale: shared in-flight promise prevents overlapping
    // refreshState calls from racing if a poll takes longer than the interval.
    private refreshInFlight?: Promise<void>;

    constructor(nativeId: string) {
        super(nativeId);
        process.nextTick(() => this.refreshState().catch(e => this.console.warn('refresh state failed', e)));
        // Random first-fire offset to spread load when many bulbs are constructed together.
        const jitter = Math.floor(Math.random() * STATE_POLL_INTERVAL_MS);
        this.pollStartTimer = setTimeout(() => {
            this.pollStartTimer = undefined;
            this.pollTimer = setInterval(() => this.refreshState().catch(() => { }), STATE_POLL_INTERVAL_MS);
        }, jitter);
    }

    getSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }

    putSetting(key: string, value: SettingValue): Promise<void> {
        return this.storageSettings.putSetting(key, value);
    }

    async turnOn(): Promise<void> {
        await this.lightState({ on_off: 1 });
        this.on = true;
    }

    async turnOff(): Promise<void> {
        await this.lightState({ on_off: 0 });
        this.on = false;
    }

    async setBrightness(brightness: number): Promise<void> {
        await this.lightState({ brightness });
        this.brightness = brightness;
    }

    async setHsv(hue: number, saturation: number, value: number): Promise<void> {
        // Switch the bulb to color mode (mode 1) when HSV is set; without this some bulbs
        // ignore the hue/saturation while in color-temperature mode.
        await this.lightState({
            color_temp: 0,
            hue,
            saturation,
            brightness: value,
        });
        this.hsv = { h: hue, s: saturation, v: value };
        this.brightness = value;
    }

    async setColorTemperature(kelvin: number): Promise<void> {
        await this.lightState({ color_temp: kelvin });
        this.colorTemperature = kelvin;
    }

    async getTemperatureMinK(): Promise<number> {
        return this.storageSettings.values.colorTemperatureMinK;
    }

    async getTemperatureMaxK(): Promise<number> {
        return this.storageSettings.values.colorTemperatureMaxK;
    }

    async refreshState(): Promise<void> {
        if (this.refreshInFlight)
            return this.refreshInFlight;
        this.refreshInFlight = this.refreshStateInternal()
            .finally(() => { this.refreshInFlight = undefined; });
        return this.refreshInFlight;
    }

    private async refreshStateInternal(): Promise<void> {
        if (!this.storageSettings.values.ip)
            return;
        const sys = await getSysInfo(this.iotOptions());
        const ls = sys?.light_state;
        if (!ls)
            return;
        // light_state during off-state nests the actual values under `dft_on_state`.
        const active = ls.on_off ? ls : (ls.dft_on_state || {});
        this.on = ls.on_off === 1;
        if (typeof active.brightness === 'number')
            this.brightness = active.brightness;
        if (typeof active.color_temp === 'number')
            this.colorTemperature = active.color_temp;
        if (typeof active.hue === 'number' && typeof active.saturation === 'number') {
            const hsv: ColorHsv = {
                h: active.hue,
                s: active.saturation,
                v: typeof active.brightness === 'number' ? active.brightness : 100,
            };
            this.hsv = hsv;
        }
    }

    private lightState(state: Record<string, any>): Promise<any> {
        // ignore_default tells the bulb to merge with current state instead of resetting.
        return kasaIotCall(this.iotOptions(), {
            'smartlife.iot.smartbulb.lightingservice': {
                transition_light_state: { ignore_default: 1, ...state },
            },
        });
    }

    private iotOptions() {
        return {
            host: this.storageSettings.values.ip,
            port: this.storageSettings.values.port,
        };
    }

    release(): void {
        clearInterval(this.pollTimer);
        clearTimeout(this.pollStartTimer);
    }
}
