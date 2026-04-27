import { Brightness } from '@scrypted/sdk';
import { KasaIotDevice } from './kasa-plug';

// Dimmable Kasa devices (HS220 dimmer plug, KS230 3-way dimmer switch, etc.). Same
// relay protocol as KasaPlug/KasaSwitch plus a brightness command:
//   {"smartlife.iot.dimmer":{"set_brightness":{"brightness":N}}}
//
// Always exposed as `Light` since these are essentially always wired to a light fixture
// (the Kasa app does the same). On/off uses the relay; brightness uses the dimmer module.
export class KasaDimmer extends KasaIotDevice implements Brightness {
    async setBrightness(brightness: number): Promise<void> {
        await this.callIot({ 'smartlife.iot.dimmer': { set_brightness: { brightness } } });
        this.brightness = brightness;
    }

    protected onSysInfo(sys: Record<string, any>): void {
        if (typeof sys.brightness === 'number')
            this.brightness = sys.brightness;
    }
}
