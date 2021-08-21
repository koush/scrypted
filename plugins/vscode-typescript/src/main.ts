// https://developer.scrypted.app/#getting-started
// package.json contains the metadata (name, interfaces) about this device
// under the "scrypted" key.
import axios from 'axios';
import { OnOff, ScryptedDeviceBase } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
const { log } = sdk;

log.i('Hello World. This will create a virtual OnOff device.');
// OnOff is a simple binary switch. See "interfaces"  in package.json
// to add support for more capabilities, like Brightness or Lock.

class Device extends ScryptedDeviceBase implements OnOff {
    constructor() {
        super();
        this.on = this.on || false;
    }
    async turnOff() {
        log.i('turnOff was called!');
        this.on = false;
    }
    async turnOn() {
        // set a breakpoint here.
        log.i('turnOn was called!');

        log.i("Let's pretend to perform a web request on an API that would turn on a light.");
        const ip = await axios.get('http://jsonip.com');
        log.i(`my ip: ${ip.data.ip}`);

        this.on = true;
    }
}

export default new Device();
