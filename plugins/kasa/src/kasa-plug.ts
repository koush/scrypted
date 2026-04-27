import { OnOff, ScryptedDeviceBase, Setting, Settings, SettingValue } from '@scrypted/sdk';
import { StorageSettings } from '@scrypted/sdk/storage-settings';
import { KASA_IOT_PORT, getSysInfo, kasaIotCall } from './kasa-iot';

const STATE_POLL_INTERVAL_MS = 30000;

// Shared base for every Kasa "smarthome" single-relay device — outlets, switches, and
// dimmers. Only the on/off relay protocol lives here; dimmable devices add Brightness on
// top in KasaDimmer.
//
// Wire protocol (TCP/9999):
//   on/off:    {"system":{"set_relay_state":{"state":1|0}}}
//   query:     {"system":{"get_sysinfo":{}}}
//
// Multi-outlet strips (HS300, KP303) aren't modeled — they need per-child relay handling.
export abstract class KasaIotDevice extends ScryptedDeviceBase implements OnOff, Settings {
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
    });

    private pollTimer?: NodeJS.Timeout;
    private pollStartTimer?: NodeJS.Timeout;
    // Guard against overlapping polls: if a refresh is in-flight when the interval fires
    // (e.g., the camera is slow), the second call would open a parallel TCP connection
    // and could race the first response. Sharing the in-flight promise avoids that.
    private refreshInFlight?: Promise<void>;

    constructor(nativeId: string) {
        super(nativeId);
        // Drive an initial state refresh on next tick (so storageSettings is ready) and a
        // periodic poll thereafter so external state changes (other apps, physical button
        // presses) eventually surface in Scrypted/HomeKit. A small per-instance jitter on
        // the first poll spreads the load when many devices were started together.
        process.nextTick(() => this.refreshState().catch(e => this.console.warn('refresh state failed', e)));
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
        await this.callIot({ system: { set_relay_state: { state: 1 } } });
        this.on = true;
    }

    async turnOff(): Promise<void> {
        await this.callIot({ system: { set_relay_state: { state: 0 } } });
        this.on = false;
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
        if (!sys)
            return;
        if (typeof sys.relay_state === 'number')
            this.on = sys.relay_state === 1;
        // Subclasses with extra state extend via onSysInfo hook.
        this.onSysInfo(sys);
    }

    // Hook for subclasses to consume additional sysinfo fields (e.g. brightness for dimmers).
    protected onSysInfo(_sys: Record<string, any>): void { }

    protected callIot(command: Record<string, any>): Promise<any> {
        return kasaIotCall(this.iotOptions(), command);
    }

    protected iotOptions() {
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

// Plain Kasa plugs/outlets (HS100/HS103/HS105/HS107/HS110/KP100/etc.) — single relay,
// no brightness. Dimmer plugs (HS220) are handled by KasaDimmer instead.
export class KasaPlug extends KasaIotDevice {
}
