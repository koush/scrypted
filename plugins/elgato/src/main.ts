
import bonjour, { Bonjour } from "bonjour";
import { KeyLight } from './lights';
import sdk, { Device, ScryptedDeviceBase, OnOff, Brightness, ColorSettingTemperature, Refresh, ScryptedDeviceType, DeviceProvider } from '@scrypted/sdk';
const { deviceManager } = sdk;


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
}


class ElgatoDevice extends ScryptedDeviceBase implements OnOff, Brightness, ColorSettingTemperature, Refresh {
  light: KeyLight;
  device: Device;
  refresher: Function;

  constructor(light: KeyLight, device: Device) {
    super(device.nativeId);
    this.light = light;
    this.device = device;

    this.refresher = (err) => this.refresh();

    // schedule a refresh. not doing it immediately, to allow the device to be reported
    // by sync first.
    setImmediate(() => this.refresh());
  }


  async refresh() {
    await this.light.refresh();
    this.updateState();
  }

  updateState() {
    this.on = !!this.light.options.lights[0].on;
    this.brightness = this.light.options.lights[0].brightness;
    let temperature = this.light.options.lights[0].temperature;
    let kelvin = Math.round(Math.pow(1000000 * temperature, -1))
    this.temperature = kelvin;
  }

  async getRefreshFrequency() {
    return 5;
  }

  // setters

  async turnOn() {
    await this.light.turnOn();
    this.updateState();
  }

  async turnOff() {
    await this.light.turnOff();
    this.updateState();
  }

  async setBrightness(level: number) {
    await this.light.setBrightness(level);
    this.updateState();
  }

  async setColorTemperature(kelvin: number) {
    await this.light.setColorTemperature(kelvin)
    this.updateState();
  }

  async getTemperatureMinK() {
    return 2900;
  }

  async getTemperatureMaxK() {
    return 7000;
  }

}

class ElgatoController implements DeviceProvider {
  lights: any = {};
  private bonjour: Bonjour;

  constructor() {
    this.bonjour = bonjour();
    this.discoverDevices(30);
  }

  getDevice(id) {
    return this.lights[id];
  }

  newLight(light: KeyLight) {
    var info = {
      name: light.info.productName,
      nativeId: light.info.serialNumber,
      interfaces: ['OnOff', 'Brightness', 'ColorSettingTemperature', 'Refresh'],
      type: ScryptedDeviceType.Light,
    };

    deviceManager.onDeviceDiscovered(info);
    this.lights[light.info.serialNumber] = new ElgatoDevice(light, info);
  }

  async discoverDevices(duration: number) {
    const browser = this.bonjour.find({ type: 'elgato key' });
    browser.on('up', service => {
        let newLight = new KeyLight(service['referer'].address, service.port, service.name);
        this.newLight(newLight);
    });
    browser.start();
      setTimeout(() => {
        browser.stop();
      }, duration * 1000);
  
  }
}

export default new ElgatoController();