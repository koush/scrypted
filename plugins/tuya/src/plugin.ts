import {
  AdoptDevice,
  Device,
  DeviceDiscovery,
  DeviceProvider,
  DiscoveredDevice,
  ScryptedDeviceBase,
  ScryptedDeviceType,
  ScryptedInterface,
  ScryptedNativeId,
  Setting,
  Settings,
  sdk
} from "@scrypted/sdk";

import { TuyaCloud } from "./tuya/cloud";
import { TuyaDevice } from "./tuya/device";
import { TuyaCamera } from "./camera";
import { getTuyaPulsarEndpoint, TUYA_COUNTRIES } from "./tuya/utils";
import { TuyaPulsar, TuyaPulsarMessage } from "./tuya/pulsar";
import { TuyaCloudConfig, TuyaManager } from "./tuya/manager";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import { TuyaLogin, TuyaLoginMethod } from "./tuya/api";

export class TuyaPlugin extends ScryptedDeviceBase implements DeviceProvider, DeviceDiscovery, Settings {
  settingsStorage = new StorageSettings(this, {
    loginMethod: {
      title: "Login Method",
      type: 'radiobutton',
      choices: [TuyaLoginMethod.App, TuyaLoginMethod.Account],
      immediate: true,
      onPut: () => this.reconfigureManager()
    },
    userCode: {
      title: "User Code",
      description: "Required: You can find this information in Tuya (Smart Life) App -> Settings -> Account and Security -> User Code.",
      onPut: () => this.reconfigureManager()
    },
    qrCode: {
      title: "Login QR Code",
      type: 'html',
      description: "Scan with the Tuya (Smart Life) app to sign in.",
      readonly: true,
      hide: true,
      value: '<p>Once you have set a value in "User Code", a QR Code will be generated.</p>'
    },

    // Old development account config
    userId: {
      title: "User ID",
      type: 'string',
      description: "Required: You can find this information in Tuya IoT -> Cloud -> Devices -> Linked Devices.",
      onPut: () => this.reconfigureManager()
    },
    accessId: {
      title: "Access ID",
      type: 'string',
      description: "Requirerd: This is located on the main project.",
      onPut: () => this.reconfigureManager()
    },
    accessKey: {
      title: "Access Key/Secret",
      description: "Requirerd: This is located on the main project.",
      type: "password",
      onPut: () => this.reconfigureManager()
    },
    country: {
      title: "Country",
      description:
        "Required: This is the country where you registered your devices.",
      type: "string",
      choices: TUYA_COUNTRIES.map((value) => value.country),
      onPut: () => this.reconfigureManager()
    }
  });

  constructor(nativeId?: string) {
    super(nativeId);

    this.reconfigureManager()
  }

  discoverDevices(scan?: boolean): Promise<DiscoveredDevice[]> {
    return Promise.resolve([])
  }

  async adoptDevice(device: AdoptDevice): Promise<string> {
    return await Promise.reject()
  }

  async getDevice(nativeId: ScryptedNativeId): Promise<TuyaCamera | undefined> {
    return await Promise.reject()
  }

  async releaseDevice(id: string, nativeId: ScryptedNativeId): Promise<void> {
  }

  async getSettings(): Promise<Setting[]> {
    const userCode = this.settingsStorage.values.userCode || "";
    var loginMethod = this.settingsStorage.values.loginMethod;

    // If old version had userId, use TuyaLoginMethod.Account
    if (!loginMethod && !!this.settingsStorage.values.userId) {
      loginMethod = TuyaLoginMethod.Account
    } else if (!loginMethod) {
      // Else assign the default login method as app.
      loginMethod = TuyaLoginMethod.App
    }

    if (!this.settingsStorage.values.loginMethod) {
      // Assign login method if no value is set.
      this.settingsStorage.putSetting('loginMethod', loginMethod);
    }

    // Show new login method
    this.settingsStorage.settings.userCode.hide = loginMethod != TuyaLoginMethod.App;
    this.settingsStorage.settings.qrCode.hide = loginMethod != TuyaLoginMethod.App || !userCode;

    // Show old login method
    this.settingsStorage.settings.userId.hide = loginMethod != TuyaLoginMethod.Account;
    this.settingsStorage.settings.accessId.hide = loginMethod != TuyaLoginMethod.Account;
    this.settingsStorage.settings.accessKey.hide = loginMethod != TuyaLoginMethod.Account;
    this.settingsStorage.settings.country.hide = loginMethod != TuyaLoginMethod.Account;
    return await this.settingsStorage.getSettings();
  }

  async putSetting(key: string, value: string): Promise<void> {
    return this.settingsStorage.putSetting(key, value);
  }

  private validatedLoginInfo() {
    var method = this.settingsStorage.values.loginMethod;
    if (!method && !!this.settingsStorage.values.userId) {
      method = TuyaLoginMethod.Account
    } else if (!method) {
      method = TuyaLoginMethod.App
    }

    var login: TuyaLogin | null = null;

    if (method == TuyaLoginMethod.App && !!this.settingsStorage.values.userCode) {
      login = {
        type: TuyaLoginMethod.App,
        userCode: this.settingsStorage.values.userCode
      }
    } else if (
      method == TuyaLoginMethod.Account &&
      !!this.settingsStorage.values.accessId,
      !!this.settingsStorage.values.userId,
      !!this.settingsStorage.values.accessKey,
      !!this.settingsStorage.values.country
    ) {
      login = {
        type: TuyaLoginMethod.Account,
        accessId: this.settingsStorage.values.accessId,
        userId: this.settingsStorage.values.userId,
        accessSecret: this.settingsStorage.values.accessKey,
        country: this.settingsStorage.values.country
      }
    }
    return login;
  }

  private reconfigureManager() {
    const loginInfo = this.validatedLoginInfo();
    if (!loginInfo) return;
  }
}