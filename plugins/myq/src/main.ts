// webpack polyfill 'usage' does not seem to work on modules.
// include directly.
import MyQ from 'myq-api';
import sdk, { ScryptedDeviceBase, DeviceProvider, Device, ScryptedDeviceType, Entry, Refresh, OnOff } from '@scrypted/sdk';
const { log } = sdk;

const {deviceManager} = sdk;
const username = localStorage.getItem('username');
const password = localStorage.getItem('password');

function alertAndThrow(msg) {
  log.a(msg);
  throw new Error(msg);
}

if (!username) {
  alertAndThrow('The "username" Script Setting values is missing.');
}

if (!password) {
  alertAndThrow('The "password" Script Setting values is missing.');
}

class GarageController extends ScryptedDeviceBase implements DeviceProvider {
  devices: object = {};
  account: MyQ;
  loginTokenTime: number;

  constructor() {
    super();
    this.ensureLogin()
    .then(() => {
      var devices = [];
      var payload = {
          devices,
      };
      return this.account.getDevices([3, 7, 17])
      .then((result) => {
        if (!result) {
          log.e('Unable to query MyQ service. Are your "username" and "password" correct?');
          return;
        }
  
        log.i(`device query: ${JSON.stringify(result)}`);
        if (!result) {
          log.e('Unable to query MyQ service. Are your "username" and "password" correct?');
          return;
        }
        result = result.devices;
        for (var r of result) {
          if (r.state.door_state) {
            var info: Device = {
              name: r.name,
              nativeId: r.serial_number,
              interfaces: ['Entry', 'Refresh'],
              type: ScryptedDeviceType.Entry,
            }
            this.devices[info.nativeId] = new GarageDoor(this, info);
          }
          else {
            continue;
          }
  
          devices.push(info);
        }
  
        deviceManager.onDevicesChanged(payload);
      });
    });
  }

  ensureLogin() {
    // 30 minute token it seems
    if (this.account && this.loginTokenTime > Date.now() - 29 * 60 * 1000) {
      return Promise.resolve(this.account);
    }
  
    var account = new MyQ();
    
    return account.login(username, password)
    .then((result) => {
      if (result.code !== 'OK') {
        throw new Error(JSON.stringify(result));
      }
      log.i(`login result: ${JSON.stringify(result)}`);
      this.account = account;
      this.loginTokenTime = Date.now();
  
      return this.account;
    })
    .catch((err) => {
      log.e('Error logging in. Are the "username" and/or "password" script configuration values correct?\n' + err);
      throw err;
    });
  }

  getDevice(nativeId) {
    return this.devices[nativeId];
  }
  discoverDevices(duration: number): void {
    throw new Error("Method not implemented.");
  }
}

class GarageDoor extends ScryptedDeviceBase implements Entry, Refresh {
  controller: GarageController;
  info: Device;

  constructor(controller, info: Device) {
    super(info.nativeId)
    this.controller = controller;
    this.info = info;
    this.refresh();
  }

  doorStateCommand(state) {
    this.controller.ensureLogin()
    .then(() => this.controller.account.setDoorState(this.info.nativeId, state))
    .then((result) => {
      log.i(JSON.stringify(result));
    })
    .catch((err) => {
      log.e('garage door command failed: ' + err);
    })
    .then(() => this.refresh());

    setTimeout(() => this.refresh(), 60000);
  }
  
  closeEntry(): void {
    this.doorStateCommand(MyQ.actions.door.CLOSE);
  }
  openEntry(): void {
    this.doorStateCommand(MyQ.actions.door.OPEN);
  }
  async getRefreshFrequency() {
    return 60;
  }
  refresh() {
    this.controller.ensureLogin()
    .then(() => this.controller.account.getDoorState(this.info.nativeId))
    .then((result) => {
      log.i(`Refresh: ${JSON.stringify(result)}`);
      this.entryOpen = result.deviceState !== 'closed';
    })
    .catch((err) => {
      log.e(`error getting door state: ${err}`);
    });
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

  lightStateCommand(state) {
    this.controller.ensureLogin()
    .then(() => this.controller.account.setLightState(this.info.nativeId, state))
    .then((result) => {
      log.i(JSON.stringify(result));
    })
    .catch((err) => {
      log.e('light command failed: ' + err);
    })
    .then(() => this.refresh());

    setTimeout(() => this.refresh(), 60000);
  }
  turnOn() {
    this.lightStateCommand(1);
  }
  turnOff() {
    this.lightStateCommand(0);
  }
  refresh() {
    this.controller.ensureLogin()
    .then(() => this.controller.account.getLightState(this.info.nativeId))
    .then((result) => {
      log.i(`Refresh: ${JSON.stringify(result)}`);
      if (result.lightState !== undefined) {
        this.on = result.lightState !== 0;
      }
    })
    .catch((err) => {
      log.e(`error getting light state: ${err}`);
    });
  };
  async getRefreshFrequency() {
    return 60;
  };
}

export default new GarageController();
