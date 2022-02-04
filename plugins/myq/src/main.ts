import sdk, { ScryptedDeviceBase, DeviceProvider, Device, ScryptedDeviceType, Entry, Refresh, OnOff, Settings, Setting, EntrySensor, ScryptedInterface, Battery } from '@scrypted/sdk';
const { log } = sdk;
import { myQApi, myQDevice, myQDeviceInterface } from '@hjdhjd/myq';
import throttle from 'lodash/throttle';

const { deviceManager } = sdk;

function isValidGarageDoor(device: myQDeviceInterface) {
  //return device_type === 'wifigaragedooropener' || device_type === 'virtualgaragedooropener' || device_type === 'garagedooropener';
  return device.device_family === 'garagedoor'
}

class GarageController extends ScryptedDeviceBase implements DeviceProvider, Settings, Battery {
  devices = new Map<string, GarageDoor>();
  account: myQApi;
  loginTokenTime: number;
  start: Promise<void>;
  throttleRefresh = throttle(async () => {
    try {
      await this.discoverDevices(0);
      await this.updateStates();
    }
    catch (e) {
      console.error('refresh failed', e);
    }
  }, 60000, {
    leading: true,
    trailing: true,
  });

  constructor() {
    super();
    this.start = this.discoverDevices(0);
    this.start.then(() => this.updateStates());
    this.start.catch(e => console.error('discovery error', e));
  }

  async getSettings(): Promise<Setting[]> {
    return [
      {
        title: 'Email',
        key: 'email',
        value: localStorage.getItem('email'),
      },
      {
        title: 'Password',
        type: 'password',
        key: 'password',
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
    this.devices[nativeId]?.refresh();
    return this.devices[nativeId];
  }
  async discoverDevices(duration: number) {
    if (!this.account) {
      const email = localStorage.getItem('email');
      const password = localStorage.getItem('password');
      if (!email || !password) {
        throw new Error('Not logged in.');
      }
  
      this.account = new myQApi(email, password, console);
    }

    await this.account.refreshDevices();
    console.log(this.account.devices);
    
    const devices: Device[] = [];
    for (const device of this.account.devices) {
      if (!isValidGarageDoor(device)) {
        console.log('ignoring device', device);
        continue;
      }
      
      const interfaces = [ScryptedInterface.Entry, ScryptedInterface.EntrySensor, ScryptedInterface.Refresh];

      if (device.state.dps_low_battery_mode !== undefined)
        interfaces.push(ScryptedInterface.Battery);

      devices.push({
        name: device.name,
        nativeId: device.serial_number,
        interfaces,
        type: ScryptedDeviceType.Garage,
      });
    }

    await deviceManager.onDevicesChanged({
      devices,
    });
  }

  async updateStates() {
    for (const device of this.account.devices) {
      if (!isValidGarageDoor(device)) {
        console.log('ignoring device', device);
        continue;
      }

      const d = await this.getDevice(device.serial_number) as GarageDoor;
      d.entryOpen = device.state.door_state !== 'closed';

      // there's no battery level, so set it to full or empty.
      // consumers of the battery level can decide when to alert on low battery.
      if (device.state.dps_low_battery_mode !== undefined)
        d.batteryLevel = device.state.dps_low_battery_mode ? 0 : 100;
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
    setTimeout(() => this.refresh(), 60000);
  }
  async openEntry() {
    this.controller.account.execute(this.device, 'open');
    setTimeout(() => this.refresh(), 60000);
  }
  async getRefreshFrequency() {
    return 60;
  }
  async refresh() {
    this.controller.throttleRefresh();
  }
}

// class GarageLight extends ScryptedDeviceBase implements OnOff, Refresh {
//   controller: GarageController;
//   info: Device;

//   constructor(controller, info: Device) {
//     super(info.nativeId);
//     this.controller = controller;
//     this.info = info;
//     this.refresh();
//   }

//   async turnOn() {
//     // this.lightStateCommand(1);
//   }
//   async turnOff() {
//     // this.lightStateCommand(0);
//   }
//   async refresh() {
//   };
//   async getRefreshFrequency() {
//     return 60;
//   };
// }

export default new GarageController();
