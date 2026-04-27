import { KasaIotDevice } from './kasa-plug';

// Plain Kasa wall switches (HS200/HS210/KS200/etc.) — single relay, no brightness.
// Dimmer switches like KS230 are handled by KasaDimmer instead.
export class KasaSwitch extends KasaIotDevice {
}
