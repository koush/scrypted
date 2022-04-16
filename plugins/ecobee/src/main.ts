import axios, { AxiosRequestConfig } from 'axios'
import sdk, { Device, DeviceInformation, ScryptedDeviceBase, OnOff, DeviceProvider, ScryptedDeviceType, ThermostatMode, Thermometer, HumiditySensor, TemperatureSetting, Settings, Setting, ScryptedInterface, Refresh, TemperatureUnit, HumidityCommand, HumidityMode, HumiditySetting } from '@scrypted/sdk';
const { deviceManager, log } = sdk;

const API_RETRY = 2;

// Convert Fahrenheit to Celsius, round to 2 decimal places
function convertFtoC(f: number) {
  let c = (5/9) * (f - 32)
  return Math.round(c*100)/100
}

// Convert Celsius to Fahrenheit, round to 1 decimal place
function convertCtoF(c: number) {
  let f = (c * 1.8) + 32
  return Math.round(f*10)/10
}

function ecobeeToThermostatMode(mode: string) {
  //  Values: auto, auxHeatOnly, cool, heat, off
  switch(mode) {
    case "cool":
      return ThermostatMode.Cool;
    case "heat":
      return ThermostatMode.Heat;
    case "auto":
      return ThermostatMode.Auto;
    case "off":
      return ThermostatMode.Off;
  }
}

function thermostatModeToEcobee(mode: ThermostatMode) {
  //  Values: auto, auxHeatOnly, cool, heat, off
  switch(mode) {
    case ThermostatMode.Cool:
      return "cool";
    case ThermostatMode.Heat:
      return "heat";
    case ThermostatMode.Auto:
      return "auto";
    case ThermostatMode.Off:
      return "off";
  }
}

function humModeFromEcobee(mode: string): HumidityMode {
  // Values: auto, manual, off
  switch(mode) {
    case 'auto':
      return HumidityMode.Auto;
    case "manual":
      return HumidityMode.Humidify;
  }

  return HumidityMode.Off
}

class EcobeeThermostat extends ScryptedDeviceBase implements HumiditySensor, Thermometer, TemperatureSetting, Refresh, OnOff, HumiditySetting, Settings {
  device: any;
  revisionList: string[];
  provider: EcobeeController;
  on: boolean;

  constructor(nativeId: string, provider: EcobeeController) {
    super(nativeId);
    this.provider = provider;
    this.revisionList = null;

    this.temperatureUnit = TemperatureUnit.F
    const modes: ThermostatMode[] = [ThermostatMode.Cool, ThermostatMode.Heat, ThermostatMode.Auto, ThermostatMode.Off];
    this.thermostatAvailableModes = modes;

    let humModes: HumidityMode[] = [HumidityMode.Auto, HumidityMode.Humidify, HumidityMode.Off];
    this.humiditySetting = {
      mode: HumidityMode.Off,
      availableModes: humModes,
    }

    setImmediate(() => this.refresh("constructor", false));
  }

  async getSettings(): Promise<Setting[]> {
    return [
      {
        title: 'Additional Devices',
        key: 'additional_devices',
        value: this.storage.getItem("additional_devices"),
        choices: ['Fan', 'Humidifier'],
        description: 'Display additional devices for components',
        multiple: true,
      }
    ]
  }

  async putSetting(key: string, value: string): Promise<void> {
    this.storage.setItem(key, value.toString());
  }

  /*
   * Get the recommended refresh/poll frequency in seconds for this device.
   */
   async getRefreshFrequency(): Promise<number> {
      return 15;
   }

   /* refresh(): Request from Scrypted to refresh data from device 
    *            Poll from API '/thermostatSummary' endpoint for timestamp of last changes and compare to last check
    *            Updates equipmentStatus on each call
    */
   async refresh(refreshInterface: string, userInitiated: boolean): Promise<void> {
    this.console.log(`${refreshInterface} requested refresh\n ${new Date()}`)
    
    const json = {
      selection: {
        selectionType: "registered",
        selectionMatch: this.nativeId,
        includeEquipmentStatus: true,
      }
    }
    const data = await this.provider.req('get', 'thermostatSummary', json)

    // Update equipmentStatus, trigger reload if changes detected
    this._updateEquipmentStatus(data.statusList[0].split(":")[1]);
    if (this._updateRevisionList(data.revisionList[0]))
      await this.reload()
   }

  /*
   * Set characteristics based on equipmentStatus from API
   * 
   *  Possible eqipmentStatus values:
   *    heatPump, heatPump[2-3], compCool[1-2], auxHeat[1-3],
   *    fan, humidifier, dehumidifier, ventilator, economizer,
   *    compHotWater, auxHotWater
   */
   _updateEquipmentStatus(equipmentStatus: string): void {
    equipmentStatus = equipmentStatus.toLowerCase()
    this.console.log(` Current status: ${equipmentStatus}`);
    if (equipmentStatus.includes("heat"))
      // values: heatPump, heatPump[2-3], auxHeat[1-3]
      this.thermostatActiveMode = ThermostatMode.Heat;
    else if (equipmentStatus.includes("cool"))
      // values: compCool[1-2]
      this.thermostatActiveMode = ThermostatMode.Cool;
    else
      this.thermostatActiveMode = ThermostatMode.Off;

    // fan status
    if (equipmentStatus.includes('fan')) {
      this.on = true;
    } else {
      this.on = false;
    }

    // humidifier status
    let activeMode = HumidityMode.Off
    if (equipmentStatus.includes('humidifier')) {
      activeMode = HumidityMode.Humidify
    }
    this.humiditySetting = Object.assign(this.humiditySetting, { activeMode });
  }

  /* revisionListChanged(): Compare a new revision list to the stored list, return true if changed
   *  
   */
  _updateRevisionList(listStr: string): boolean {
    const listItems = ["tId", "tName", "connected", "thermostat", "alerts", "runtime", "interval"];
    const oldList = this.revisionList;
    this.revisionList = listStr.split(':');
    
    if (!oldList)
      return true;

    // Compare each element, skip first 3
    for (let i = 3; i < listItems.length; i++) {
      if (this.revisionList[i] !== oldList[i]) {
        this.console.log(` Changes detected: ${listItems[i]}`)
        return true;
      }
    }

    this.console.log(" Changes detected: none");
    return false;
  }

  /* reload(): Reload all thermostat data from API '/thermostat' endpoint
   *
   */
  async reload(): Promise<void> {
    const json = {
      selection: {
        selectionType: "registered",
        selectionMatch: this.nativeId,
        includeSettings: true,
        includeRuntime: true,
        includeEquipmentStatus: true,
      }
    }
    const data = (await this.provider.req('get', 'thermostat', json)).thermostatList[0];

    // Set runtime values
    this.temperature = convertFtoC(Number(data.runtime.actualTemperature)/10)
    this.humidity = Number(data.runtime.actualHumidity);

    // Set current equipment status values
    this._updateEquipmentStatus(data.equipmentStatus);

    // update based on mode
    this.thermostatMode = ecobeeToThermostatMode(data.settings.hvacMode);

    this.thermostatSetpointHigh = convertFtoC(Number(data.runtime.desiredCool)/10)
    this.thermostatSetpointLow = convertFtoC(Number(data.runtime.desiredHeat)/10)
    switch(data.settings.hvacMode) {
      case 'cool':
        this.thermostatSetpoint = convertFtoC(Number(data.runtime.desiredCool)/10)
        break;
      case 'heat':
        this.thermostatSetpoint = convertFtoC(Number(data.runtime.desiredHeat)/10)
        break;
    }

    // update humidifier based on mode
    this.humiditySetting = Object.assign(this.humiditySetting, {
      mode: humModeFromEcobee(data.settings.humidifierMode),
      humidifierSetpoint: Number(data.settings.humidity),
    });
  }

  async setHumidity(humidity: HumidityCommand): Promise<void> {
    this.console.log(`setHumidity ${humidity.mode} ${humidity.humidifierSetpoint}: not yet supported`);
  }

  async setTemperatureUnit(temperatureUnit: TemperatureUnit): Promise<void> {
    this.temperatureUnit = temperatureUnit;
  }
  
  async setThermostatMode(mode: ThermostatMode): Promise<void> {
    this.console.log(`setThermostatMode ${mode}`)
    
    const data = {
      selection: {
        selectionType:"registered",
        selectionMatch: this.nativeId,
      },
      thermostat: {
        settings:{
          hvacMode: thermostatModeToEcobee(mode)
        }
      }
    }

    const resp = await this.provider.req('post', 'thermostat', undefined, data);
    if (resp.status.code == 0) {
      this.console.log("setThermostatMode success")
      await this.reload();
      return;
    }

    this.console.log(`setThermostatMode failed: ${resp}`)
  }

  async setThermostatSetpoint(degrees: number): Promise<void> {
    const degF = convertCtoF(degrees);
    this.console.log(`setThermostatSetpoint ${degrees}C/${degF}F`)

    if (this.thermostatMode === ThermostatMode.Auto) {
      this.console.log(`setThermostatSetpoint not running in auto mode`)
      return;
    }

    const data = {
      selection: {
        selectionType:"registered",
        selectionMatch: this.nativeId,
      },
      functions: [
        {
          type:"setHold",
          params:{
            holdType: "nextTransition",
            heatHoldTemp: degF*10,
            coolHoldTemp: degF*10,
          }
        }
      ]
    }

    const resp = await this.provider.req('post', 'thermostat', undefined, data)
    if (resp.status.code == 0) {
      this.console.log("setThermostatSetpoint success")
      await this.reload();
      return;
    }

    this.console.log(`setThermostatSetpoint failed: ${resp}`)
  }

  async setThermostatSetpointHigh(high: number): Promise<void> {
    const degFLow = convertCtoF(this.thermostatSetpointLow);
    const degFHigh = convertCtoF(high);
    this.console.log(`setThermostatSetpointHigh ${high}C/${degFHigh}F`)

    const data = {
      selection: {
        selectionType:"registered",
        selectionMatch: this.nativeId,
      },
      functions: [
        {
          type:"setHold",
          params:{
            holdType: "nextTransition",
            heatHoldTemp: degFLow*10,
            coolHoldTemp: degFHigh*10,
          }
        }
      ]
    }

    const resp = await this.provider.req('post', 'thermostat', undefined, data)
    if (resp.status.code == 0) {
      this.console.log("setThermostatSetpointHigh success")
      await this.reload();
      return;
    }

    this.console.log(`setThermostatSetpointHigh failed: ${resp}`)
  }
  
  async setThermostatSetpointLow(low: number): Promise<void> {
    const degFLow = convertCtoF(low);
    const degFHigh = convertCtoF(this.thermostatSetpointHigh);
    this.console.log(`setThermostatSetpointLow ${low}C/${degFLow}F`)

    const data = {
      selection: {
        selectionType:"registered",
        selectionMatch: this.nativeId,
      },
      functions: [
        {
          type:"setHold",
          params:{
            holdType: "nextTransition",
            heatHoldTemp: degFLow*10,
            coolHoldTemp: degFHigh*10,
          }
        }
      ]
    }

    const resp = await this.provider.req('post', 'thermostat', undefined, data)
    if (resp.status.code == 0) {
      this.console.log("setThermostatSetpointLow success")
      await this.reload();
      return;
    }

    this.console.log(`setThermostatSetpointLow failed: ${resp}`)
  }

  async turnOff(): Promise<void> {
    this.console.log(`fanOff: setting fan to auto`)

    const data = {
      selection: {
        selectionType: "registered",
        selectionMatch: this.nativeId,
      },
      functions: [
        {
          type: "setHold",
          params: {
            coolHoldTemp: 900,
            heatHoldTemp: 550,
            holdType: "nextTransition",
            fan: "auto",
            isTemperatureAbsolute: "false",
            isTemperatureRelative: "false",
          }
        }
      ]
    }

    const resp = await this.provider.req('post', 'thermostat', undefined, data);
    if (resp.status.code == 0) {
      this.console.log("fanOff success")
      await this.reload();
      return;
    }

    this.console.log(`fanOff failed: ${resp}`)
  }

  async turnOn(): Promise<void> {
    this.console.log(`fanOn: setting fan to on`)

    const data = {
      selection: {
        selectionType: "registered",
        selectionMatch: this.nativeId,
      },
      functions: [
        {
          type:"setHold",
          params: {
            coolHoldTemp: 900,
            heatHoldTemp: 550,
            holdType: "nextTransition",
            fan: "on",
            isTemperatureAbsolute: "false",
            isTemperatureRelative: "false",
          }
        }
      ]
    }

    const resp = await this.provider.req('post', 'thermostat', undefined, data);
    if (resp.status.code == 0) {
      this.console.log("fanOn success")
      await this.reload();
      return;
    }

    this.console.log(`fanOn failed: ${resp}`)
  }
}

class EcobeeController extends ScryptedDeviceBase implements DeviceProvider, Settings {
  devices = new Map<string, any>();
  access_token: string;

  constructor() {
    super()
    this.log.clearAlerts();
    if (!this.storage.getItem("api_base"))
      this.storage.setItem("api_base", "api.ecobee.com");

    this.initialize();
  }

  async initialize(): Promise<void> {
    // If no clientId, request clientId to start authentication process
    if (!this.storage.getItem("client_id")) {
      this.log.a("You must specify a client ID.")
      this.console.log("Enter a client ID for this app from the Ecobee developer portal. Then, collect the PIN and enter in Ecobee 'My Apps'. Restart this app to complete.")
      return;
    }

    if (!this.storage.getItem("refresh_token"))
      // If no refresh_token, try to get token
      await this.getToken();
    else if (!this.access_token)
      await this.refreshToken();

    this.discoverDevices();
  }

  async getSettings(): Promise<Setting[]> {
    return [
      {
        group: "API",
        title: "API Base URL",
        key: "api_base",
        description: "Customize the API base URL",
        value: this.storage.getItem("api_base"),
      },
      {
        group: "API",
        title: "API Client ID",
        key: "client_id",
        description: "Your Client ID from the Ecboee developer portal",
        value: this.storage.getItem("client_id"),
      }
    ]
  }

  async putSetting(key: string, value: string): Promise<void> {
    this.storage.setItem(key, value.toString());

    // Try to get a code when a client ID is saved
    if (key === "client_id") {
      await this.getCode();
    }
  }

  // Get a code from Ecobee API for user verification
  async getCode() {
    // GET https://api.ecobee.com/authorize?response_type=ecobeePin&client_id=APP_KEY&scope=SCOPE
    const authUrl = `https://${this.storage.getItem("api_base")}/authorize`
    const authParams = {
      response_type:'ecobeePin',
      scope: "smartWrite",
      client_id: this.storage.getItem("client_id"),
    }
    let authData = (await axios.get(authUrl, {
      params: authParams,
    })).data
    
    this.log.clearAlerts();
    this.log.a(`Got code ${authData.ecobeePin}. Enter this in 'My Apps' Ecobee portal. Then restart this app.`)
    this.storage.setItem("ecobee_code", authData.code);
  }

  // Trade the validated code for an access token
  async getToken() {
    // POST https://api.ecobee.com/token?grant_type=ecobeePin&code=AUTHORIZATION_TOKEN&client_id=APP_KEY&ecobee_type=jwt
    const tokenUrl = `https://${this.storage.getItem("api_base")}/token`
    const tokenParams = {
      grant_type:'ecobeePin',
      code: this.storage.getItem("ecobee_code"),
      client_id: this.storage.getItem("client_id"),
      ecobee_type: "jwt",
    };
    let tokenData = (await axios.post(tokenUrl, null, {
      params: tokenParams
    })).data;
    this.access_token = tokenData.access_token;
    this.storage.setItem("refresh_token", tokenData.refresh_token);
    console.log(`Stored access/refresh token`)
  }

  // Refresh the tokens
  async refreshToken() {
    // POST https://api.ecobee.com/token?grant_type=refresh_token&refresh_token=REFRESH_TOKEN&client_id=APP_KEY&ecobee_type=jwt
    const tokenUrl = `https://${this.storage.getItem("api_base")}/token`
    const tokenParams = {
      grant_type:'refresh_token',
      refresh_token: this.storage.getItem("refresh_token"),
      client_id: this.storage.getItem("client_id"),
      ecobee_type: "jwt",
    };
    let tokenData = (await axios.post(tokenUrl, null, {
      params: tokenParams
    })).data;
    this.access_token = tokenData.access_token;
    this.storage.setItem("refresh_token", tokenData.refresh_token);
    console.log(`Refreshed access/refresh token`)
  }

  // Generic API request
  async req(
    method: string,
    endpoint: string,
    json?: any,
    data?: any,
    attempt?: number,
  ): Promise<any> {
    if (attempt > API_RETRY) {
      throw new Error(` request to ${method}:${endpoint} failed after ${attempt} retries`);
    }

    // Configure API request
    const config: AxiosRequestConfig = {
      method,
      baseURL: `https://${this.storage.getItem("api_base")}/1/`,
      url: endpoint,
      headers: {
        Authorization: `Bearer ${this.access_token}`,
      },
      data,
      timeout: 10000,
    }
    if (json)
      config.params = { json };

    // Make API request, recursively retry after token refresh
    try {
      return (await axios.request(config)).data;
    } catch (e) {
      this.console.log(`req failed ${e}`)
      // refresh token and retry request
      await this.refreshToken();
      return await this.req(method, endpoint, json, data, attempt++);
    }
  }

  async discoverDevices(): Promise<void> {
    // Get a list of all accessible devices
    const json = {
      selection: {
        selectionType: "registered",
        selectionMatch: "",
        includeSettings: true,
      }
    }
    const apiDevices = (await this.req('get', 'thermostat', json)).thermostatList;
    this.console.log(`Discovered ${apiDevices.length} devices.`);

    // Create a list of devices found from the API
    const devices: Device[] = [];
    for (let apiDevice of apiDevices) {
      this.console.log(` Discovered ${apiDevice.brand} ${apiDevice.modelNumber} ${apiDevice.name} (${apiDevice.identifier})`);

      const interfaces: ScryptedInterface[] = [
        ScryptedInterface.Thermometer,
        ScryptedInterface.TemperatureSetting,
        ScryptedInterface.Refresh,
        ScryptedInterface.HumiditySensor,
        ScryptedInterface.OnOff,
        ScryptedInterface.Settings,
      ]
      if (apiDevice.settings.hasHumidifier)
        interfaces.push(ScryptedInterface.HumiditySetting);
      
      const device: Device = {
        nativeId: apiDevice.identifier,
        name: `${apiDevice.modelNumber} thermostat`,
        type: ScryptedDeviceType.Thermostat,
        info: {
          model: apiDevice.brand,
          manufacturer: apiDevice.modelNumber,
          serialNumber: apiDevice.identifier,
        },
        interfaces,
      }
      devices.push(device);
    }

    // Sync full device list
    await deviceManager.onDevicesChanged({
        devices,
    });

    for (let device of devices) {
      let providerDevice = this.devices.get(device.nativeId);
      if (!providerDevice) {
        providerDevice = new EcobeeThermostat(device.nativeId, this)
        this.devices.set(device.nativeId, providerDevice)
      }
    }
  }

  getDevice(nativeId: string) {
    return this.devices.get(nativeId);
  }

}

export default new EcobeeController();
