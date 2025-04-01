import sdk, {
  Device,
  DeviceProvider,
  ScryptedDeviceBase,
  ScryptedDeviceType,
  ScryptedInterface,
  ScryptedNativeId,
  Setting,
  Settings
} from "@scrypted/sdk";
import { StorageSettings } from "@scrypted/sdk/storage-settings";

import QRCode from "qrcode-svg";

import { TuyaLoginMethod, TuyaTokenInfo } from "./tuya/const";
import { TuyaLoginQRCode, TuyaSharingAPI } from "./tuya/sharing";
import { TuyaAccessory } from "./accessories/accessory";
import { TuyaCloudAPI } from "./tuya/cloud";
import { TUYA_COUNTRIES } from "./tuya/deprecated";
import { TuyaPulsarMessage } from "./tuya/pulsar";
import { createTuyaDevice } from "./accessories/factory";
import { TuyaMQ } from "./tuya/mq";

export class TuyaPlugin extends ScryptedDeviceBase implements DeviceProvider, Settings {
  api: TuyaSharingAPI | TuyaCloudAPI | undefined;
  mq: TuyaMQ | undefined;
  devices = new Map<string, TuyaAccessory>();

  settingsStorage = new StorageSettings(this, {
    loginMethod: {
      title: "Login Method",
      type: 'radiobutton',
      choices: [TuyaLoginMethod.App, TuyaLoginMethod.Account],
      immediate: true,
      onPut: () => this.tryLogin()
    },
    userCode: {
      title: "User Code",
      description: "Required: You can find this information in Tuya (Smart Life) App -> Settings -> Account and Security -> User Code.",
      onPut: () => this.tryLogin()
    },
    qrCode: {
      title: "Login QR Code",
      type: 'html',
      description: "Scan with the Tuya (Smart Life) app to sign in.",
      readonly: true,
      noStore: true,
      immediate: true,
      mapGet(value) {
        if (value) {
          return new QRCode(`tuyaSmart--qrLogin?token=${(value as TuyaLoginQRCode).result.qrcode}`).svg({ container: "svg" })
        } else {
          return "Refresh browser to get the login QR Code"
        }
      },
    },
    qrCodeLoggedIn: {
      title: "Did scan QR Code?",
      type: "boolean",
      defaultValue: false,
      noStore: true,
      immediate: true,
      onPut: () => this.tryLogin({ loggedInClicked: true })
    },

    // Old development account config
    userId: {
      title: "User ID",
      type: 'string',
      description: "Required: You can find this information in Tuya IoT -> Cloud -> Devices -> Linked Devices.",
      onPut: () => this.tryLogin()
    },
    accessId: {
      title: "Access ID",
      type: 'string',
      description: "Requirerd: This is located on the main project.",
      onPut: () => this.tryLogin()
    },
    accessKey: {
      title: "Access Key/Secret",
      description: "Requirerd: This is located on the main project.",
      type: "password",
      onPut: () => this.tryLogin()
    },
    country: {
      title: "Country",
      description:
        "Required: This is the country where you registered your devices.",
      type: "string",
      choices: TUYA_COUNTRIES.map((value) => value.country),
      onPut: () => this.tryLogin()
    },

    // Token Storage
    tokenInfo: {
      hide: true,
      json: true
    },

    // TODO: Show who is logged in.
    loggedIn: {
      title: "Logged in as: ",
      hide: true,
      noStore: true,
      type: "string",
      readonly: true
    }
  });

  constructor(nativeId?: string) {
    super(nativeId);
    this.tryLogin({ useTokenFromStorage: true });
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

    this.settingsStorage.settings.loginMethod.defaultValue = loginMethod;

    // Show new login method
    this.settingsStorage.settings.userCode.hide = loginMethod != TuyaLoginMethod.App;
    this.settingsStorage.settings.qrCode.hide = loginMethod != TuyaLoginMethod.App || !userCode || !!this.settingsStorage.values.tokenInfo;
    this.settingsStorage.settings.qrCodeLoggedIn.hide = this.settingsStorage.settings.qrCode.hide;

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

  async getDevice(nativeId: string) {
    return this.devices.get(nativeId)
  }

  async releaseDevice(id: string, nativeId: ScryptedNativeId): Promise<void> {
    this.console.info(`[${this.name}] (${new Date().toLocaleString()}) Device with id '${nativeId}' was removed.`);
  }

  private async tryLogin(state: { useTokenFromStorage?: boolean, loggedInClicked?: boolean } = {}) {
    this.api = undefined;
    this.mq = undefined;
    this.log.clearAlerts();

    const { useTokenFromStorage, loggedInClicked } = state;

    let storeToken: TuyaTokenInfo | undefined = useTokenFromStorage ? this.settingsStorage.values.tokenInfo : undefined;

    if (!storeToken) {
      var method = this.settingsStorage.values.loginMethod;
      if (!method && !!this.settingsStorage.values.userId) {
        method = TuyaLoginMethod.Account
      } else if (!method) {
        method = TuyaLoginMethod.App
      }

      switch (method) {
        case TuyaLoginMethod.App:
          const userCode = this.settingsStorage.values.userCode;
          const qrCodeValue = this.settingsStorage.settings.qrCode.defaultValue as TuyaLoginQRCode | undefined;
          if (!userCode) {
            this.settingsStorage.settings.qrCode.defaultValue = undefined;
            this.onDeviceEvent(ScryptedInterface.Settings, undefined);
          } else if (!qrCodeValue || qrCodeValue.userCode != userCode) {
            this.settingsStorage.settings.qrCode.defaultValue = undefined;
            try {
              const qrCode = await TuyaSharingAPI.generateQRCode(userCode);
              this.settingsStorage.settings.qrCode.defaultValue = qrCode;
            } catch (e) {
              this.console.log(`[${this.name}] (${new Date().toLocaleString()}) Failed to fetch new QR Code.`, e);
            }
            this.onDeviceEvent(ScryptedInterface.Settings, undefined);
          } else if (loggedInClicked) {
            try {
              const token = await TuyaSharingAPI.fetchToken(qrCodeValue);
              storeToken = { type: TuyaLoginMethod.App, ...token };
              this.settingsStorage.settings.qrCode.defaultValue = undefined;
            } catch (e) {
              this.console.log(`[${this.name}] (${new Date().toLocaleString()}) Failed to authenticate with QR Code.`, e);
              this.log.a("Failed to authenticate with credentials. Ensure you scanned the QR Code with Tuya (Smart Life) App and try again.");
            }
            this.onDeviceEvent(ScryptedInterface.Settings, undefined);
          }
          break;
        case TuyaLoginMethod.Account:
          try {
            const token = await TuyaCloudAPI.fetchToken(
              this.settingsStorage.values.userId,
              this.settingsStorage.values.accessId,
              this.settingsStorage.values.accessKey,
              this.settingsStorage.values.country
            )
            storeToken = { type: TuyaLoginMethod.Account, ...token };
          } catch (e) {
            this.console.log(`[${this.name}] (${new Date().toLocaleString()}) Failed to authenticate.`, e);
            this.log.a("Failed to authenticate with credentials.");
          }
          break;
      }
    } else {
      this.console.info(`[${this.name}] (${new Date().toLocaleString()}) Using stored token for login.`);
    }

    this.settingsStorage.putSetting('tokenInfo', storeToken ? JSON.stringify(storeToken) : undefined);

    if (!storeToken) return;
    await this.initializeDevices(storeToken);
  }

  private async initializeDevices(token: TuyaTokenInfo) {
    switch (token.type) {
      case TuyaLoginMethod.App:
        this.api = new TuyaSharingAPI(
          token,
          (updatedToken) => {
            this.settingsStorage.putSetting("tokenInfo", JSON.stringify({ ...updatedToken, type: TuyaLoginMethod.App }))
          },
          () => {
            this.settingsStorage.putSetting("tokenInfo", undefined);
            this.console.log(`[${this.name}] (${new Date().toLocaleString()}) Request reauthentication.`);
            this.onDeviceEvent(ScryptedInterface.Settings, undefined);
            this.log.a(`Reauthentication to Tuya required. Refresh plugin to retrieve new QR Code.`)
          }
        );
        break;
      case TuyaLoginMethod.Account:
        this.api = new TuyaCloudAPI(
          token,
          (updatedToken) => {
            this.settingsStorage.putSetting("tokenInfo", JSON.stringify({ ...updatedToken, type: TuyaLoginMethod.Account }))
          },
          () => {
            this.settingsStorage.putSetting("tokenInfo", undefined);
            this.console.log(`[${this.name}] (${new Date().toLocaleString()}) Request reauthentication.`);
            this.log.a(`Reauthentication to Tuya required. Refresh plugin to log in again.`)
          }
        );
    }

    // if (this.api instanceof TuyaSharingAPI) {
    //   const mqConfig = await this.api.fetchMqttConfig();
    //   this.mq = new TuyaMQ(mqConfig);
    // }

    // this.mq?.message((mq, msg) => {
    //   this.console.log("New message", msg);
    // });

    // await this.mq?.connect();

    // this.mq = new TuyaMQ();

    const devices = await this.api.fetchDevices();

    this.devices = new Map(
      devices.map(d => {
        const device = createTuyaDevice(d, this);
        return !!device ? [d.id, device] : undefined
      })
      .filter((p): p is [string, TuyaAccessory] => !!p)
    );

    sdk.deviceManager.onDevicesChanged({
      devices: Array.from(this.devices.values()).map(d => ({ ...d.deviceSpecs, providerNativeId: this.nativeId }))
    });
  }

  private onMessage(message: TuyaPulsarMessage) {
    // const data = message.payload.data;
    // const { devId, productKey } = data;
    // let refreshDevice = false;

    // const device = this.devices.get(devId);

    // let messageLogs: string[] = ["Received new TuyaPulsar Message:"];

    // if (data.bizCode) {
    //   if (device && (data.bizCode === "online" || data.bizCode === "offline")) {
    //     // Device status changed
    //     const isOnline = data.bizCode === "online";
    //     device.online = isOnline;
    //     refreshDevice = true;
    //     messageLogs.push(
    //       `- Changed device to ${data.bizCode} for ${device.name}`
    //     );
    //   } else if (device && data.bizCode === "delete") {
    //     // Device needs to be deleted
    //     // - devId
    //     // - uid

    //     messageLogs.push(`- Delete ${device.name} from homekit`);
    //     const { uid } = data.bizData;
    //     // TODO: delete device
    //   } else if (data.bizCode === "add") {
    //     // TODO: There is a new device added, refetch
    //     messageLogs.push(
    //       `- Add new device with devId: ${data.devId} to homekit`
    //     );
    //   } else {
    //     messageLogs.push(
    //       `- Unknown bizCode: ${data.bizCode} with data: ${JSON.stringify(
    //         data.bizData
    //       )}.`
    //     );
    //   }
    // } else if (device && data.status) {
    //   const newStatus = data.status || [];

    //   messageLogs.push(`- ${device.name} received new status updates:`);

    //   newStatus.forEach((item) => {
    //     messageLogs.push(`\t- ${JSON.stringify(item)}`);

    //     // const index = device.status.findIndex(
    //     //   (status) => status.code == item.code
    //     // );
    //     // if (index !== -1) {
    //     //   device.status[index].value = item.value;
    //     // }
    //   });

    //   refreshDevice = true;
    // } else {
    //   messageLogs.push(
    //     `- Unknown TuyaPulsar message received: ${JSON.stringify(data)}`
    //   );
    // }

    // messageLogs.push("");
    // // this.console.debug(pulsarMessageLogs.join("\n"));

    // if (refreshDevice) {
    //   return this.devices.get(devId);
    // }
  }
}