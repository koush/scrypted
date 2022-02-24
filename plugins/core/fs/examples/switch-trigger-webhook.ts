import { ScriptDevice } from "@scrypted/common/src/eval/monaco/script-device"; // SCRYPTED_FILTER_EXAMPLE_LINE
import { OnOff, ScryptedDeviceBase } from "@scrypted/sdk"; // SCRYPTED_FILTER_EXAMPLE_LINE
declare const device: ScriptDevice & ScryptedDeviceBase; // SCRYPTED_FILTER_EXAMPLE_LINE

// A switch that handles on/off state. 
// The switch will make a web request that prints the server's external IP when turned on.

class SwitchWebhookExample implements OnOff {
    async turnOff(): Promise<void> {
        device.on = false;
    }
    async turnOn() {
        device.on = true;
        const response = await fetch('http://jsonip.com');
        const { ip } = await response.json();
        console.log('my ip:', ip);
    }
}

device.handle(new SwitchWebhookExample());
