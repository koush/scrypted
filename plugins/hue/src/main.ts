import hue from "node-hue-api";
const { v3 } = hue;
import sdk, { Brightness, Device, DeviceManager, DeviceProvider, OnOff, Refresh, ScryptedDeviceBase } from '@scrypted/sdk';
const { deviceManager, log } = sdk;
import axios from "axios";
import Api from "node-hue-api/lib/api/Api";

const LightState = v3.lightStates.LightState;
const LocalBootstrap = require("./bootstrap");

let username;
let bridgeId = localStorage.getItem('bridgeId');
let bridgeAddress = localStorage.getItem('bridgeAddress');;
if (!bridgeId) {
    log.i('No "bridgeId" was specified in Plugin Settings. Press the pair button on the Hue bridge.');
    log.i('Searching for Hue Bridge...');
}
else {
    username = localStorage.getItem(`user-${bridgeId}`);
    if (username) {
        log.i(`Using existing login for bridge ${bridgeId}`);
    }
    else {
        log.i(`No login found for ${bridgeId}. You will need to press the pairing button on your Hue bridge, and the save plugin to reload it.`);
    }
}

const StateSetters = {
    OnOff: function (s, state) {
        state.on = !!(s && s.on);
    },
    Brightness: function (s, state) {
        state.brightness = (s && s.bri && (s.bri * 100 / 254)) || 0;
    },
    ColorSettingTemperature: function (s, state) {
        state.colorTemperature = (s && s.ct && (1000000 / s.ct)) || 0;
    },
    ColorSettingHsv: function (st, state) {
        var h = (st && st.hue && st.hue / 182.5487) || 0;
        var s = (st && st.sat && (st.sat / 254));
        var v = (st && st.bri && (st.bri / 254));
        state.hsv = { h, s, v };
    }
}

class HueBulb extends ScryptedDeviceBase implements OnOff, Brightness, Refresh {
    api: Api;
    light: any;
    device: Device;

    constructor(api, light, device) {
        super(light.id.toString());

        this.api = api;
        this.light = light;
        this.device = device;

        // wait for this device to be synced, then report the current state.
        setImmediate(() => {
            this.updateState(light.state);
        });
    }

    refresh(refreshInterface: string, userInitiated: boolean): void {
        this._refresh();
    }

    updateState(state) {
        for (var event of this.device.interfaces) {
            var setter = StateSetters[event];
            if (setter) {
                setter(state, this);
            }
        }
    }

    async _refresh() {
        const result = await this.api.lights.getLight(this.light.id);
        if (result && result.state) {
            this.updateState(result.state);
        }
    }

    getRefreshFrequency() {
        return 5;
    }

    async turnOff() {
        await this.api.lights.setLightState(this.light.id, new LightState().off());
        this._refresh();
    };

    async turnOn () {
        await this.api.lights.setLightState(this.light.id, new LightState().on(undefined));
        this._refresh();
    };

    async setBrightness (level) {
        await this.api.lights.setLightState(this.light.id, new LightState().brightness(level));
        this._refresh();
    }

    async setTemperature (kelvin) {
        var mired = Math.round(1000000 / kelvin);
        await this.api.lights.setLightState(this.light.id, new LightState().ct(mired));
        this._refresh();
    }

    async setHsv (h, s, v) {
        await this.api.lights.setLightState(this.light.id, new LightState().hsb(h, s * 100, v * 100));
        this._refresh();
    }
}

class HueHub extends ScryptedDeviceBase implements DeviceProvider {
    api: Api;
    devices = {};

    async discoverDevices(duration: number) {
        const result = await this.api.lights.getAll()

        var devices = [];
        var payload = {
            devices: devices,
        };

        // 182.5487

        for (var light of result) {
            var interfaces = ['OnOff', 'Brightness', 'Refresh'];
            if (light.type.toLowerCase().indexOf('color') != -1) {
                interfaces.push('ColorSettingHsv');
                interfaces.push('ColorSettingTemperature');
            }

            var device = {
                nativeId: light.id,
                name: light.name,
                interfaces: interfaces,
                type: 'Light',
            };

            log.i(`Found device: ${JSON.stringify(device)}`);
            devices.push(device);

            this.devices[light.id] = new HueBulb(this.api, light, device);
        }

        deviceManager.onDevicesChanged(payload);
    }
    getDevice(nativeId: string): object {
        return this.devices[nativeId];
    }
}

const hueHub = new HueHub();


async function search() {
    const response = await axios.get('https://discovery.meethue.com', {
        headers: { accept: 'application/json' },
    });

    if (response.status !== 200)
        throw new Error(`Status code unexpected when using N-UPnP endpoint: ${response.status}`);

    const bridges = response.data;

    if (!bridgeId) {
        if (bridges.length == 0) {
            log.e('No Hue bridges found');
            return;
        }
        else if (bridges.length != 1) {
            log.e('Multiple hue bridges found: ');
            for (let found of bridges) {
                log.e(found.id);
            }
            log.e('Please specify which bridge to manage using the Plugin Setting "bridgeId"');
            return;
        }

        bridgeId = bridges[0].id;
        log.i(`Found bridge ${bridgeId}. Setting as default.`);
        localStorage.setItem('bridgeId', bridgeId);
    }

    let foundAddress;
    for (let found of bridges) {
        if (found.id == bridgeId) {
            foundAddress = found.internalipaddress;
            break;
        }
    }

    if (!foundAddress) {
        if (!bridgeAddress) {
            log.e(`Unable to locate bridge address for bridge: ${bridgeId}.`);
            return;
        }

        log.w('Unable to locate most recent bridge address with nupnp search. using last known address.')
    }
    else {
        bridgeAddress = foundAddress;
    }

    log.i(`Hue Bridges Found: ${bridgeId}`);


    if (!username) {
        const unauthenticatedApi = await v3.api.createLocal(bridgeAddress).connect();
        try {
            const createdUser = await unauthenticatedApi.users.createUser(bridgeAddress, 'ScryptedServer');
            log.i(`Created user on ${bridgeId}: ${createdUser}`);
            username = createdUser.username;
            localStorage.setItem(`user-${bridgeId}`, username);
        }
        catch (e) {
            log.a(`Unable to create user on bridge ${bridgeId}: ${e}`);
            log.a('You may need to press the pair button on the bridge.');
            throw e;
        }
    }

    log.i('Querying devices...');

    hueHub.api = await new LocalBootstrap(bridgeAddress).connect(username);

    log.clearAlerts();
    hueHub.discoverDevices(null);
}

search().catch(err => {
    throw new Error(`Problems resolving hue bridges, ${err.message}`);
})

export default hueHub;
