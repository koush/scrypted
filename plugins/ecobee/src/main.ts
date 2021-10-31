import axios from 'axios'
import sdk, { Device, ScryptedDeviceBase, OnOff, DeviceProvider, ScryptedDeviceType, ThermostatMode, Thermometer, HumiditySensor, TemperatureSetting, Settings, Setting, ScryptedInterface, Refresh, TemperatureUnit } from '@scrypted/sdk';
const { deviceManager, log } = sdk;

// Convert Fahrenheit to Celsius
function convertFtoC(f: number) {
  return (5/9) * (f - 32)
}

// Convert Celsius to Fahrenheit
function convertCtoF(c: number) {
  return (c * 1.8) + 32
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

class EcobeeThermostat extends ScryptedDeviceBase implements HumiditySensor, Thermometer, TemperatureSetting, Refresh, OnOff {
  device: any;
  revisionList: string[];
  provider: EcobeeController;
  on: boolean;

  constructor(nativeId: string, provider: EcobeeController) {
    super(nativeId);
    this.provider = provider;
    this.revisionList = null;

    setImmediate(() => this.refresh("constructor", false));
  }

  /* initialconfig(): set initial device characteristics
   *
   */
  initialconfig(data): void {
    this.temperatureUnit = TemperatureUnit.F
    var modes: ThermostatMode[] = [ThermostatMode.Cool, ThermostatMode.Heat, ThermostatMode.Auto, ThermostatMode.Off];
    this.thermostatAvailableModes = modes;

    this.console.log(data);
    // set device info
    this.info = {
      model: data.brand,
      manufacturer: data.modelNumber,
      serialNumber: data.identifier,
    }
  }

  /*
   * Get the recommended refresh/poll frequency in seconds for this device.
   */
   async getRefreshFrequency(): Promise<number> {
      return 30;
   }

   /* refresh(): Request from Scrypted to refresh data from device 
    *
    */
   async refresh(refreshInterface: string, userInitiated: boolean): Promise<void> {
    this.console.log(`refresh(${refreshInterface}, ${userInitiated}): ${new Date()}`)
    this._refresh();
   }
   
  /* _refresh(): Poll from API '/thermostatSummary' endpoint for timestamp of last changes and compare to last check
   *             Updates equipmentStatus on each call
   *
   */
   async _refresh(): Promise<void> {
      const data = await this.provider.req('get', 'thermostatSummary', null, {
        json: `\{"selection":\{"selectionType":"registered","selectionMatch":"${this.nativeId}","includeSettings": "true", "includeRuntime": "true", "includeEquipmentStatus": "true"\}\}`
      });

      // Update equipmentStatus, trigger reload if changes detected
      this._updateEquipmentStatus(data.statusList[0].split(":")[1]);
      if (this._updateRevisionList(data.revisionList[0]))
        await this.reload()
  }

  /*
   * Set characteristics based on equipmentStatus from API
   */
   _updateEquipmentStatus(equipmentStatus: string): void {
    equipmentStatus = equipmentStatus.toLowerCase()
    this.console.log(`Equipment status: ${equipmentStatus}`);
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
        this.console.log(`Change detected: ${listItems[i]}`)
        return true;
      }
    }

    this.console.log("No changes detected");
    return false;
  }

  /* reload(): Reload all thermostat data from API '/thermostat' endpoint
   *
   */
  async reload(): Promise<void> {
    var data = (await this.provider.req('get', 'thermostat', {}, {
      json: `\{"selection":\{"selectionType":"registered","selectionMatch":"${this.nativeId}","includeSettings": "true", "includeRuntime": "true", "includeEquipmentStatus": "true"\}\}`
    })).thermostatList[0];

    // Set runtime values
    this.temperature = convertFtoC(Number(data.runtime.actualTemperature)/10)
    this.humidity = Number(data.runtime.actualHumidity);

    // Set current equipment status values
    this._updateEquipmentStatus(data.equipmentStatus);

    // update based on mode
    this.thermostatMode = ecobeeToThermostatMode(data.settings.hvacMode);
    switch(data.settings.hvacMode) {
      case 'auto':
        // TODO: figure out setpoint range
        break;
      case 'cool':
        this.thermostatSetpoint = convertFtoC(Number(data.runtime.desiredCool)/10)
        break;
      case 'heat':
        this.thermostatSetpoint = convertFtoC(Number(data.runtime.desiredHeat)/10)
        break;
    }
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

    var resp = await this.provider.req('post', 'thermostat', data, { format: "json" })
    if (resp.status.code == 0) {
      this.console.log("setThermostatMode success")
      await this.reload();
      return;
    }

    this.console.log(`setThermostatMode failed: ${resp}`)
  }

  async setThermostatSetpoint(degrees: number): Promise<void> {
    const degF = Math.round(convertCtoF(degrees)*10);
    this.console.log(`setThermostatSetpoint ${degrees}C/${degF}F`)

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
            heatHoldTemp: degF,
            coolHoldTemp: degF,
          }
        }
      ]
    }

    var resp = await this.provider.req('post', 'thermostat', data, { format: "json" })
    if (resp.status.code == 0) {
      this.console.log("setThermostatSetpoint success")
      await this.reload();
      return;
    }

    this.console.log(`setThermostatSetpoint failed: ${resp}`)
  }

  async setThermostatSetpointHigh(high: number): Promise<void> {
    this.console.log(`setThermostatSetpointHigh ${high}`)
    return;
  }
  
  async setThermostatSetpointLow(low: number): Promise<void> {
    this.console.log(`setThermostatSetpointLow ${low}`)
    return;
  }

  async turnOff(): Promise<void> {
    this.console.log(`fanOff`)
    // resume program
    // https://www.ecobee.com/home/developer/api/documentation/v1/functions/ResumeProgram.shtml
    const data = {
      selection: {
        selectionType:"registered",
        selectionMatch: this.nativeId,
      },
      functions: [
        {
          type:"resumeProgram",
          params:{
            resumeAll: "false",
          }
        }
      ]
    }

    var resp = await this.provider.req('post', 'thermostat', data, { format: "json" })
    if (resp.status.code == 0) {
      this.console.log("fanOff success")
      await this.reload();
      return;
    }

    this.console.log(`fanOff failed: ${resp}`)
  }

  async turnOn(): Promise<void> {
    this.console.log(`fanOn`)

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
            fan: "on",
          }
        }
      ]
    }

    var resp = await this.provider.req('post', 'thermostat', data, { format: "json" })
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
  clientId: string;
  apiBaseUrl: string;
  ecobeeCode: string;
  access_token: string;
  refresh_token: string;

  constructor() {
    super()
    this.clientId = this.storage.getItem("client_id");
    this.apiBaseUrl = this.storage.getItem("api_base") || "api.ecobee.com";
    this.access_token = this.storage.getItem("access_token");
    this.refresh_token = this.storage.getItem("refresh_token");

    this.discoverDevices()
  }

  async getSettings(): Promise<Setting[]> {
    return [
      {
        group: "API",
        title: "API Base URL",
        key: "api_base",
        description: "Customize the API base URL",
        value: this.apiBaseUrl,
      },
      {
        group: "API",
        title: "API Client ID",
        key: "client_id",
        description: "Your Client ID from the Ecboee developer portal",
        value: this.clientId,
      },
      {
        group: "API Detail",
        title: "Access Token",
        key: "access_token",
        readonly: true,
        value: this.access_token || "You must complete the authentication process",
      },
      {
        group: "API Detail",
        title: "Refresh Token",
        key: "refresh_token",
        readonly: true,
        value: this.refresh_token || "You must complete the authentication process",
      }
    ]
  }

  async putSetting(key: string, value: string): Promise<void> {
    this.storage.setItem(key, value.toString());
  }

  // Get a code from Ecobee API for user verification
  async getCode() {
    // GET https://api.ecobee.com/authorize?response_type=ecobeePin&client_id=APP_KEY&scope=SCOPE
    const authUrl = `https://${this.apiBaseUrl}/authorize`
    const authParams = {
      response_type:'ecobeePin',
      scope: "smartWrite",
      client_id: this.clientId,
    }
    let authData = (await axios.get(authUrl, {
      params: authParams,
    })).data
    
    this.console.log(`Got code ${authData.ecobeePin}. Enter this in 'My Apps'.`)
    this.ecobeeCode = authData.code;
  }

  // Trade the validated code for an access token
  async getToken() {
    // POST https://api.ecobee.com/token?grant_type=ecobeePin&code=AUTHORIZATION_TOKEN&client_id=APP_KEY&ecobee_type=jwt
    const tokenUrl = `https://${this.apiBaseUrl}/token`
    const tokenParams = {
      grant_type:'ecobeePin',
      code: this.ecobeeCode,
      client_id: this.clientId,
      ecobee_type: "jwt",
    };
    let tokenData = (await axios.post(tokenUrl, null, {
      params: tokenParams
    })).data;
    this.access_token = tokenData.access_token;
    this.refresh_token = tokenData.refresh_token;
    this.storage.setItem("access_token", this.access_token);
    this.storage.setItem("refresh_token", this.refresh_token);
    console.log(`Stored access/refresh token`)
  }

  // Refresh the tokens
  async refreshToken() {
    // POST https://api.ecobee.com/token?grant_type=refresh_token&refresh_token=REFRESH_TOKEN&client_id=APP_KEY&ecobee_type=jwt
    const tokenUrl = `https://${this.apiBaseUrl}/token`
    const tokenParams = {
      grant_type:'refresh_token',
      refresh_token: this.refresh_token,
      client_id: this.clientId,
      ecobee_type: "jwt",
    };
    let tokenData = (await axios.post(tokenUrl, null, {
      params: tokenParams
    })).data;
    this.access_token = tokenData.access_token;
    this.refresh_token = tokenData.refresh_token;
    this.storage.setItem("access_token", this.access_token);
    this.storage.setItem("refresh_token", this.refresh_token);
    console.log(`Refreshed access/refresh token`)
  }

  // Generic API request
  async req(method, endpoint, data, params) {
    const url = `https://${this.apiBaseUrl}/api/1/${endpoint}`
    const options = {
      headers: {
        Authorization: `Bearer ${this.access_token}`,
      },
      params: params
    }
    let resp
    try {
      if (method === "post") {
        resp = await axios.post(url, data, options)
      } else { 
        resp = await axios[method](url, options);
      }
    } catch (e) {
      // really simple retry on failure
      this.console.log("failed req(), refreshing token")
      await this.refreshToken();
      resp = await axios[method](url, options);
    }
    return resp.data;
  }

  async discoverDevices(): Promise<void> {
    // Check that required properties exist
    this.log.clearAlerts();

    if (!this.clientId) {
      this.log.a("You must specify a client ID.")
      return;
    }

    if (!this.access_token) {
      this.log.a("You must complete the authentication process.")
      return;
    }

    // Get a list of all accessible devices
    const devices = (await this.req('get', 'thermostat', null, {
      json: `\{"selection":\{"selectionType":"registered","selectionMatch":""\}\}`
    })).thermostatList
    this.console.log(`Discovered ${devices.length} devices.`)

    let deviceList = [];
    for (let i = 0; i < devices.length; i++) {
      deviceList.push({
        nativeId: devices[i].identifier,
        name: `${devices[i].modelNumber} thermostat`,
        type: ScryptedDeviceType.Thermostat,
        interfaces: [
          ScryptedInterface.HumiditySensor,
          ScryptedInterface.Thermometer,
          ScryptedInterface.TemperatureSetting,
          ScryptedInterface.Refresh,
          ScryptedInterface.OnOff,
        ]
      })
      let device = this.devices.get(devices[i].identifier);
      if (!device) {
        device = new EcobeeThermostat(devices[i].identifier, this)
        this.devices.set(devices[i].identifier, device)
        device.initialconfig(devices[i])
      }
    }

    // Sync full device list
    await deviceManager.onDevicesChanged({
        devices: deviceList,
    });
  }

  getDevice(nativeId: string) {
    return this.devices.get(nativeId);
  }

}

export default new EcobeeController();