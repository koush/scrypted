import {Client as LifxClient} from 'node-lifx';
var client = new LifxClient();
import sdk, { Device, ScryptedDeviceBase, OnOff, Brightness, ColorSettingHsv, ColorSettingTemperature, Refresh, ScryptedDeviceType, DeviceProvider } from '@scrypted/sdk';
const { deviceManager, log } = sdk;


const StateSetters = {
  OnOff: function (s, state) {
    state.on = !!(s && s.power);
  },
  Brightness: function (s, state) {
    state.brightness = (s && s.color && s.color.brightness) || 0;
  },
  ColorSettingTemperature: function (s, state) {
    state.colorTemperature = (s && s.color && s.color.kelvin) || 0;
  },
  ColorSettingHsv: function (st, state) {
    var h = (st && st.color && st.color.hue) || 0;
    var s = ((st && st.color && st.color.saturation) || 0) / 100;
    var v = ((st && st.color && st.color.brightness) || 0) / 100;
    state.hsv = { h, s, v };
  },
}


class LifxDevice extends ScryptedDeviceBase implements OnOff, Brightness, ColorSettingHsv, ColorSettingTemperature, Refresh {
  light: any;
  device: Device;
  refresher: Function;

  constructor(light: any, device: Device) {
    super(device.nativeId);
    this.light = light;
    this.device = device;

    this.refresher = (err) => this.refresh();

    // schedule a refresh. not doing it immediately, to allow the device to be reported
    // by sync first.
    setImmediate(() => this.refresh());
  }


  async refresh() {
    this._refresh();
  }

  async getRefreshFrequency() {
    return 5;
  }

  async _refresh(cb?) {
    this.light.getState((err, state) => {
      if (state) {
        for (var iface of this.device.interfaces) {
          var setter = StateSetters[iface];
          if (setter) {
            setter(state, this);
          }
        }
      }
      if (cb) {
        cb(err);
      }
    });
  }

  // setters

  async turnOn() {
    this.light.on(0, this.refresher);
  }

  async turnOff() {
    this.light.off(0, this.refresher);
  }

  async setBrightness(level: number) {
    this.light.getState((err, state) => {
      var color = state.color;
      this.light.color(color.hue, color.saturation, level, color.kelvin, undefined, this.refresher);
    })
  }

  async setColorTemperature(kelvin: number) {
    this.light.color(0, 0, 100, kelvin, undefined, this.refresher);
  }

  async setHsv(h: number, s: number, v: number) {
    this.light.color(h, Math.round(s * 100), Math.round(v * 100), undefined, undefined, this.refresher);
  }

  async getTemperatureMinK() {
    return 2500;
  }

  async getTemperatureMaxK() {
    return 9000;
  }

}

class LifxController implements DeviceProvider {
  lights: any = {};

  constructor() {
    this.discoverDevices(30);
  }

  getDevice(id) {
    return this.lights[id];
  }

  newLight(light) {
    light.getHardwareVersion((err, data) => {
      if (err) {
        log.e(`unable to get product version: ${err}`);
        return;
      }

      // these are the interfaces (capabilities) provided by this bulb
      var interfaces = ['OnOff', 'Brightness'];
      if (data.productFeatures && data.productFeatures.color) {
        interfaces.push('ColorSettingHsv');
        interfaces.push('ColorSettingTemperature');
      }
      // lifx bulbs require polling to get their state. it is not
      // actively pushed to the controller. implementing the Refresh interface allows
      // Scrypted to poll the device intelligently: such as when the UI is visible,
      // or HomeKit/Google requests a sync and needs updated state.
      interfaces.push('Refresh');

      var info = {
        name: data.productName,
        nativeId: light.id,
        interfaces: interfaces,
        type: ScryptedDeviceType.Light,
      };
      log.i(`light found: ${JSON.stringify(info)}`);

      deviceManager.onDeviceDiscovered(info);
      this.lights[light.id] = new LifxDevice(light, info);
    });
  }

  async discoverDevices(duration: number) {
    client.on('light-new', this.newLight.bind(this));
    client.init();
    setTimeout(() => {
      client.stopDiscovery();
    }, duration * 1000);

  }
}

export default new LifxController();