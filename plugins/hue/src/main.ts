import hue from "node-hue-api";
const { v3 } = hue;
import sdk, { Brightness, Device, DeviceManager, DeviceProvider, OnOff, Refresh, ScryptedDeviceBase, Setting, Settings } from '@scrypted/sdk';
const { deviceManager, log } = sdk;
import axios from "axios";
import Api from "node-hue-api/lib/api/Api";

const LightState = v3.lightStates.LightState;
const LocalBootstrap = require("./bootstrap");

const StateSetters = {
    OnOff: function (s, state) {
        state.on = !!(s && s.on && s.reachable);
    },
    Brightness: function (s, state) {
        state.brightness = (s && s.bri && (s.bri * 100 / 254)) || 0;
    },
    ColorSettingTemperature: function (s, state) {
        state.colorTemperature = (s && s.ct && (1000000 / s.ct)) || 0;
    },
    ColorSettingHsv: function (st, state) {
        var h = (st && st.hue && st.hue / 182.5487) || 0;
        var s = (st && st.sat && (st.sat / 254)) || 0;
        var v = (st && st.bri && (st.bri / 254)) || 0;
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
        process.nextTick(() => {
            this.updateState(light.state);
        });
    }

    async refresh(refreshInterface: string, userInitiated: boolean) {
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

    async getRefreshFrequency() {
        return 5;
    }

    async turnOff() {
        await this.api.lights.setLightState(this.light.id, new LightState().off());
        this._refresh();
    };

    async turnOn() {
        await this.api.lights.setLightState(this.light.id, new LightState().on(undefined));
        this._refresh();
    };

    async setBrightness(level) {
        await this.api.lights.setLightState(this.light.id, new LightState().brightness(level));
        this._refresh();
    }

    async setTemperature(kelvin) {
        var mired = Math.round(1000000 / kelvin);
        await this.api.lights.setLightState(this.light.id, new LightState().ct(mired));
        this._refresh();
    }

    async setHsv(h, s, v) {
        await this.api.lights.setLightState(this.light.id, new LightState().hsb(h, s * 100, v * 100));
        this._refresh();
    }
}

class HueHub extends ScryptedDeviceBase implements DeviceProvider, Settings {
    api: Api;
    devices = {};

    constructor() {
        super();

        (async() => {
            while (true) {
                try {
                    await this.discoverDevices(0);
                    return;
                }
                catch (e) {
                }
                await new Promise(resolve => setTimeout(resolve, 30000));
            }
        })();
    }

    async getSettings(): Promise<Setting[]> {
        return [
            {
                title: 'Bridge Address Override',
                key: 'bridgeAddress',
                placeholder: '192.168.2.100',
                value: localStorage.getItem('bridgeAddress'),
            },
            {
                title: 'Bridge ID',
                description: 'Bridge ID of the bridge currently in use. Unused if Address Override is present.',
                key: 'bridgeId',
                value: localStorage.getItem('bridgeId'),
            },
        ]
    }

    async putSetting(key: string, value: string | number | boolean) {
        localStorage.setItem(key, value?.toString());
        this.discoverDevices(0);
    }

    async discoverDevices(duration: number) {

        let addressOverride = localStorage.getItem('bridgeAddress');
        let bridgeAddress: string;
        let bridgeId: string;

        if (!addressOverride) {
            bridgeId = localStorage.getItem('bridgeId');
            if (bridgeId === 'manual')
                bridgeId = undefined;

            const response = await axios.get('https://discovery.meethue.com', {
                headers: { accept: 'application/json' },
            });

            if (response.status !== 200)
                throw new Error(`Status code unexpected when using N-UPnP endpoint: ${response.status}`);

            const bridges = response.data;

            if (!bridgeId) {
                if (bridges.length == 0) {
                    log.a('No Hue bridges found. If you know the bridge address, enter it in Settings.');
                    return;
                }
                else if (bridges.length != 1) {
                    console.error('Multiple hue bridges found: ');
                    for (const found of bridges) {
                        console.error(found.id);
                    }
                    log.a('Multiple bridges found. Please specify which bridge to manage using the Plugin Setting "bridgeId"');
                    return;
                }

                bridgeId = bridges[0].id;
                console.log(`Found bridge ${bridgeId}. Setting as default.`);
                localStorage.setItem('bridgeId', bridgeId);
            }

            for (let found of bridges) {
                if (found.id === bridgeId) {
                    bridgeAddress = found.internalipaddress;
                    break;
                }
            }

            if (!bridgeAddress) {
                console.warn(`Unable to locate bridge address for bridge: ${bridgeId}.`);
                console.warn('Unable to locate most recent bridge address with nupnp search. using last known address.')

                bridgeAddress = localStorage.getItem('lastKnownBridgeAddress');
            }
            else {
                localStorage.setItem('lastKnownBridgeAddress', bridgeAddress);
            }
        }
        else {
            bridgeAddress = addressOverride;
            bridgeId = 'manual';
            localStorage.setItem('bridgeId', 'manual');
        }

        if (!bridgeAddress) {
            log.a('Unable to discover bridge. Enter an IP address in Settings');
            return;
        }

        console.log(`Hue Bridges Found: ${bridgeId}`);
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

        let username = localStorage.getItem(`user-${bridgeId}`);

        if (!username) {
            const unauthenticatedApi = await v3.api.createLocal(bridgeAddress).connect();
            try {
                const createdUser = await unauthenticatedApi.users.createUser(bridgeAddress, 'ScryptedServer');
                console.log(`Created user on ${bridgeId}: ${createdUser}`);
                username = createdUser.username;
                localStorage.setItem(`user-${bridgeId}`, username);
            }
            catch (e) {
                console.error('user creation error', e);
                log.a('Unable to create user on bridge. You may need to press the pair button on the bridge.');
                throw e;
            }
        }

        console.log('Querying devices...');

        this.api = await new LocalBootstrap(bridgeAddress).connect(username);

        log.clearAlerts();


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

            console.log('Found device', device);
            devices.push(device);

            this.devices[light.id] = new HueBulb(this.api, light, device);
        }

        deviceManager.onDevicesChanged(payload);
        this.console.log('device discovery complete');
    }
    getDevice(nativeId: string): object {
        return this.devices[nativeId];
    }
}

export default new HueHub();
