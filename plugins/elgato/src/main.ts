
import bonjour, { Browser } from "bonjour";
import { KeyLight } from './lights';
import sdk, { Device, ScryptedDeviceBase, OnOff, Brightness, ColorSettingTemperature, Refresh, ScryptedDeviceType, DeviceProvider } from '@scrypted/sdk';
const { deviceManager, log } = sdk;

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
    let kelvin = Math.round(1000000 * Math.pow(temperature, -1))
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
    let temperature = Math.round(987007 * Math.pow(kelvin, -0.999));
    if(temperature > 7000) temperature = 7000;
    if(temperature < 2900) temperature = 2900;
    await this.light.setColorTemperature(temperature)
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

  constructor() {
    this.discoverDevices(30);
  }

  getDevice(id) {
    return this.lights[id];
  }

  async newLight(light: KeyLight) {
    await light.refresh();
    var info = {
      name: light.info.displayName,
      nativeId: light.info.serialNumber,
      interfaces: ['OnOff', 'Brightness', 'ColorSettingTemperature', 'Refresh'],
      type: ScryptedDeviceType.Light,
    };

    deviceManager.onDeviceDiscovered(info);
    this.lights[light.info.serialNumber] = new ElgatoDevice(light, info);
  }

  async discoverDevices(duration: number) {
    const browser = bonjour().find({ type: 'elg' });
    log.i(`discoverDevices...`)
    browser.on('up', service => {
        log.i(`found light: ${service.name}`)
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