// webpack polyfill 'usage' does not seem to work on modules.
// include directly.
import sdk, { ScryptedDeviceBase, DeviceProvider, Device, ScryptedDeviceType, Entry, Refresh, OnOff, Settings, Setting, EntrySensor, ScryptedInterface } from '@scrypted/sdk';
const { log } = sdk;
import { myQApi, myQDevice } from './myq/src';
import throttle from 'lodash/throttle';

const { deviceManager } = sdk;

class GarageController extends ScryptedDeviceBase implements DeviceProvider, Settings {
  devices = new Map<string, GarageDoor>();
  account: myQApi;
  loginTokenTime: number;
  start: Promise<void>;
  throttleRefresh = throttle(async () => {
    await this.discoverDevices(0);
    await this.updateStates();
  }, 60000, {
    leading: true,
  });

  constructor() {
    super();
    this.start = this.discoverDevices(0);
    this.start.then(() => this.updateStates());
  }

  async getSettings(): Promise<Setting[]> {
    return [
      {
        title: 'Email',
        value: localStorage.getItem('email'),
      },
      {
        title: 'Password',
        value: localStorage.getItem('password'),
      }
    ];
  }
  async putSetting(key: string, value: string | number | boolean) {
    localStorage.setItem(key, value.toString());
  }

  async getDevice(nativeId: string) {
    await this.start;
    if (!this.devices[nativeId])
      this.devices[nativeId] = new GarageDoor(this, this.account.devices.find(d => d.serial_number === nativeId)!);
    return this.devices[nativeId];
  }
  async discoverDevices(duration: number) {
    if (this.account) {
      return;
    }

    const email = localStorage.getItem('email');
    const password = localStorage.getItem('password');
    if (!email || !password) {
      throw new Error('Not logged in.');
    }

    this.account = new myQApi(console.log.bind(console), console, email, password);
    await this.account.refreshDevices();
    
    const devices: Device[] = [];
    for (const device of this.account.devices) {
      if (device.device_type !== 'wifigaragedooropener')
        continue;

      devices.push({
        name: device.name,
        nativeId: device.serial_number,
        interfaces: [ScryptedInterface.Entry, ScryptedInterface.EntrySensor, ScryptedInterface.Refresh],
        type: ScryptedDeviceType.Garage,
      });
    }

    await deviceManager.onDevicesChanged({
      devices,
    });
  }

  async updateStates() {
    for (const device of this.account.devices) {
      if (device.device_type !== 'wifigaragedooropener')
        continue;

      const d = await this.getDevice(device.serial_number) as GarageDoor;
      d.entryOpen = device.state.door_state !== 'closed';
    }
  }
}

class GarageDoor extends ScryptedDeviceBase implements Entry, Refresh, EntrySensor {
  controller: GarageController;

  constructor(controller: GarageController, public device: myQDevice) {
    super(device.serial_number)
    this.controller = controller;
    this.refresh();
  }

  async closeEntry() {
    this.controller.account.execute(this.device, 'close');
  }
  async openEntry() {
    this.controller.account.execute(this.device, 'open');
  }
  async getRefreshFrequency() {
    return 60;
  }
  async refresh() {
    this.controller.throttleRefresh();
  }
}

class GarageLight extends ScryptedDeviceBase implements OnOff, Refresh {
  controller: GarageController;
  info: Device;

  constructor(controller, info: Device) {
    super(info.nativeId);
    this.controller = controller;
    this.info = info;
    this.refresh();
  }

  async turnOn() {
    // this.lightStateCommand(1);
  }
  async turnOff() {
    // this.lightStateCommand(0);
  }
  async refresh() {
  };
  async getRefreshFrequency() {
    return 60;
  };
}

export default new GarageController();
