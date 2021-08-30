
const types = {
}

module.exports = types;
module.exports.default = types;
module.exports.ScryptedDeviceType = {
  Builtin: "Builtin",
  Camera: "Camera",
  Fan: "Fan",
  Light: "Light",
  Switch: "Switch",
  Outlet: "Outlet",
  Sensor: "Sensor",
  Scene: "Scene",
  Program: "Program",
  Automation: "Automation",
  Vacuum: "Vacuum",
  Notifier: "Notifier",
  Thermostat: "Thermostat",
  Lock: "Lock",
  PasswordControl: "PasswordControl",
  Display: "Display",
  Speaker: "Speaker",
  Event: "Event",
  Entry: "Entry",
  Garage: "Garage",
  DeviceProvider: "DeviceProvider",
  DataSource: "DataSource",
  API: "API",
  Doorbell: "Doorbell",
  Irrigation: "Irrigation",
  Valve: "Valve",
  Unknown: "Unknown",
}
module.exports.TemperatureUnit = {
  C: "C",
  F: "F",
}
module.exports.ThermostatMode = {
  Off: "Off",
  Cool: "Cool",
  Heat: "Heat",
  HeatCool: "HeatCool",
  Auto: "Auto",
  FanOnly: "FanOnly",
  Purifier: "Purifier",
  Eco: "Eco",
  Dry: "Dry",
  On: "On",
}
module.exports.LockState = {
  Locked: "Locked",
  Unlocked: "Unlocked",
  Jammed: "Jammed",
}
module.exports.MediaPlayerState = {
  Idle: "Idle",
  Playing: "Playing",
  Paused: "Paused",
  Buffering: "Buffering",
}

module.exports.ScryptedInterface = {
  ScryptedDevice: "ScryptedDevice",
  OnOff: "OnOff",
  Brightness: "Brightness",
  ColorSettingTemperature: "ColorSettingTemperature",
  ColorSettingRgb: "ColorSettingRgb",
  ColorSettingHsv: "ColorSettingHsv",
  Notifier: "Notifier",
  StartStop: "StartStop",
  Pause: "Pause",
  Dock: "Dock",
  TemperatureSetting: "TemperatureSetting",
  Thermometer: "Thermometer",
  HumiditySensor: "HumiditySensor",
  Camera: "Camera",
  VideoCamera: "VideoCamera",
  Lock: "Lock",
  PasswordStore: "PasswordStore",
  Authenticator: "Authenticator",
  Scene: "Scene",
  Entry: "Entry",
  EntrySensor: "EntrySensor",
  DeviceProvider: "DeviceProvider",
  Battery: "Battery",
  Refresh: "Refresh",
  MediaPlayer: "MediaPlayer",
  Online: "Online",
  SoftwareUpdate: "SoftwareUpdate",
  BufferConverter: "BufferConverter",
  Settings: "Settings",
  BinarySensor: "BinarySensor",
  IntrusionSensor: "IntrusionSensor",
  PowerSensor: "PowerSensor",
  AudioSensor: "AudioSensor",
  MotionSensor: "MotionSensor",
  OccupancySensor: "OccupancySensor",
  FloodSensor: "FloodSensor",
  UltravioletSensor: "UltravioletSensor",
  LuminanceSensor: "LuminanceSensor",
  PositionSensor: "PositionSensor",
  MediaSource: "MediaSource",
  MessagingEndpoint: "MessagingEndpoint",
  OauthClient: "OauthClient",
  MixinProvider: "MixinProvider",
  HttpRequestHandler: "HttpRequestHandler",
  EngineIOHandler: "EngineIOHandler",
  PushHandler: "PushHandler",
}

module.exports.ScryptedInterfaceDescriptors = {
  ScryptedDevice: {
      name: "ScryptedDevice",
      properties: [
        "id",
        "interfaces",
        "metadata",
        "name",
        "providedInterfaces",
        "providedName",
        "providedRoom",
        "providedType",
        "providerId",
        "room",
        "type",
      ],
      methods: [
        "listen",
        "setName",
        "setRoom",
        "setType",
      ]
  },
  OnOff: {
      name: "OnOff",
      properties: [
        "on",
      ],
      methods: [
        "turnOff",
        "turnOn",
      ]
  },
  Brightness: {
      name: "Brightness",
      properties: [
        "brightness",
      ],
      methods: [
        "setBrightness",
      ]
  },
  ColorSettingTemperature: {
      name: "ColorSettingTemperature",
      properties: [
        "colorTemperature",
      ],
      methods: [
        "getTemperatureMaxK",
        "getTemperatureMinK",
        "setColorTemperature",
      ]
  },
  ColorSettingRgb: {
      name: "ColorSettingRgb",
      properties: [
        "rgb",
      ],
      methods: [
        "setRgb",
      ]
  },
  ColorSettingHsv: {
      name: "ColorSettingHsv",
      properties: [
        "hsv",
      ],
      methods: [
        "setHsv",
      ]
  },
  Notifier: {
      name: "Notifier",
      properties: [
      ],
      methods: [
        "sendNotification",
      ]
  },
  StartStop: {
      name: "StartStop",
      properties: [
        "running",
      ],
      methods: [
        "start",
        "stop",
      ]
  },
  Pause: {
      name: "Pause",
      properties: [
        "paused",
      ],
      methods: [
        "pause",
        "resume",
      ]
  },
  Dock: {
      name: "Dock",
      properties: [
        "docked",
      ],
      methods: [
        "dock",
      ]
  },
  TemperatureSetting: {
      name: "TemperatureSetting",
      properties: [
        "thermostatAvailableModes",
        "thermostatMode",
        "thermostatSetpoint",
        "thermostatSetpointHigh",
        "thermostatSetpointLow",
      ],
      methods: [
        "setThermostatMode",
        "setThermostatSetpoint",
        "setThermostatSetpointHigh",
        "setThermostatSetpointLow",
      ]
  },
  Thermometer: {
      name: "Thermometer",
      properties: [
        "temperature",
        "temperatureUnit",
      ],
      methods: [
      ]
  },
  HumiditySensor: {
      name: "HumiditySensor",
      properties: [
        "humidity",
      ],
      methods: [
      ]
  },
  Camera: {
      name: "Camera",
      properties: [
      ],
      methods: [
        "takePicture",
      ]
  },
  VideoCamera: {
      name: "VideoCamera",
      properties: [
      ],
      methods: [
        "getVideoStream",
      ]
  },
  Lock: {
      name: "Lock",
      properties: [
        "lockState",
      ],
      methods: [
        "lock",
        "unlock",
      ]
  },
  PasswordStore: {
      name: "PasswordStore",
      properties: [
      ],
      methods: [
        "addPassword",
        "getPasswords",
        "removePassword",
      ]
  },
  Authenticator: {
      name: "Authenticator",
      properties: [
      ],
      methods: [
        "checkPassword",
      ]
  },
  Scene: {
      name: "Scene",
      properties: [
      ],
      methods: [
        "activate",
        "deactivate",
        "isReversible",
      ]
  },
  Entry: {
      name: "Entry",
      properties: [
      ],
      methods: [
        "closeEntry",
        "openEntry",
      ]
  },
  EntrySensor: {
      name: "EntrySensor",
      properties: [
        "entryOpen",
      ],
      methods: [
      ]
  },
  DeviceProvider: {
      name: "DeviceProvider",
      properties: [
      ],
      methods: [
        "discoverDevices",
        "getDevice",
      ]
  },
  Battery: {
      name: "Battery",
      properties: [
        "batteryLevel",
      ],
      methods: [
      ]
  },
  Refresh: {
      name: "Refresh",
      properties: [
      ],
      methods: [
        "getRefreshFrequency",
        "refresh",
      ]
  },
  MediaPlayer: {
      name: "MediaPlayer",
      properties: [
      ],
      methods: [
        "getMediaStatus",
        "load",
        "seek",
        "skipNext",
        "skipPrevious",
      ]
  },
  Online: {
      name: "Online",
      properties: [
        "online",
      ],
      methods: [
      ]
  },
  SoftwareUpdate: {
      name: "SoftwareUpdate",
      properties: [
        "updateAvailable",
      ],
      methods: [
        "checkForUpdate",
        "installUpdate",
      ]
  },
  BufferConverter: {
      name: "BufferConverter",
      properties: [
        "fromMimeType",
        "toMimeType",
      ],
      methods: [
        "convert",
      ]
  },
  Settings: {
      name: "Settings",
      properties: [
      ],
      methods: [
        "getSettings",
        "putSetting",
      ]
  },
  BinarySensor: {
      name: "BinarySensor",
      properties: [
        "binaryState",
      ],
      methods: [
      ]
  },
  IntrusionSensor: {
      name: "IntrusionSensor",
      properties: [
        "intrusionDetected",
      ],
      methods: [
      ]
  },
  PowerSensor: {
      name: "PowerSensor",
      properties: [
        "powerDetected",
      ],
      methods: [
      ]
  },
  AudioSensor: {
      name: "AudioSensor",
      properties: [
      ],
      methods: [
      ]
  },
  MotionSensor: {
      name: "MotionSensor",
      properties: [
        "motionDetected",
      ],
      methods: [
      ]
  },
  OccupancySensor: {
      name: "OccupancySensor",
      properties: [
        "occupied",
      ],
      methods: [
      ]
  },
  FloodSensor: {
      name: "FloodSensor",
      properties: [
        "flooded",
      ],
      methods: [
      ]
  },
  UltravioletSensor: {
      name: "UltravioletSensor",
      properties: [
        "ultraviolet",
      ],
      methods: [
      ]
  },
  LuminanceSensor: {
      name: "LuminanceSensor",
      properties: [
        "luminance",
      ],
      methods: [
      ]
  },
  PositionSensor: {
      name: "PositionSensor",
      properties: [
        "position",
      ],
      methods: [
      ]
  },
  MediaSource: {
      name: "MediaSource",
      properties: [
      ],
      methods: [
        "getMedia",
      ]
  },
  MessagingEndpoint: {
      name: "MessagingEndpoint",
      properties: [
      ],
      methods: [
      ]
  },
  OauthClient: {
      name: "OauthClient",
      properties: [
      ],
      methods: [
        "getOauthUrl",
        "onOauthCallback",
      ]
  },
  MixinProvider: {
      name: "MixinProvider",
      properties: [
      ],
      methods: [
        "canMixin",
        "getMixin",
      ]
  },
  HttpRequestHandler: {
      name: "HttpRequestHandler",
      properties: [
      ],
      methods: [
        "onRequest",
      ]
  },
  EngineIOHandler: {
      name: "EngineIOHandler",
      properties: [
      ],
      methods: [
        "onConnection",
      ]
  },
  PushHandler: {
      name: "PushHandler",
      properties: [
      ],
      methods: [
        "onPush",
      ]
  },
}

module.exports.ScryptedInterfaceProperty = {
    id: "id",
    interfaces: "interfaces",
    metadata: "metadata",
    name: "name",
    providedInterfaces: "providedInterfaces",
    providedName: "providedName",
    providedRoom: "providedRoom",
    providedType: "providedType",
    providerId: "providerId",
    room: "room",
    type: "type",
    on: "on",
    brightness: "brightness",
    colorTemperature: "colorTemperature",
    rgb: "rgb",
    hsv: "hsv",
    running: "running",
    paused: "paused",
    docked: "docked",
    thermostatAvailableModes: "thermostatAvailableModes",
    thermostatMode: "thermostatMode",
    thermostatSetpoint: "thermostatSetpoint",
    thermostatSetpointHigh: "thermostatSetpointHigh",
    thermostatSetpointLow: "thermostatSetpointLow",
    temperature: "temperature",
    temperatureUnit: "temperatureUnit",
    humidity: "humidity",
    lockState: "lockState",
    entryOpen: "entryOpen",
    batteryLevel: "batteryLevel",
    online: "online",
    updateAvailable: "updateAvailable",
    fromMimeType: "fromMimeType",
    toMimeType: "toMimeType",
    binaryState: "binaryState",
    intrusionDetected: "intrusionDetected",
    powerDetected: "powerDetected",
    motionDetected: "motionDetected",
    occupied: "occupied",
    flooded: "flooded",
    ultraviolet: "ultraviolet",
    luminance: "luminance",
    position: "position",
}

module.exports.ScryptedMimeTypes = {
  AcceptUrlParameter: 'accept-url',
  Url: 'text/x-uri',
  InsecureLocalUrl: 'text/x-insecure-local-uri',
  LocalUrl: 'text/x-local-uri',
  FFmpegInput: 'x-scrypted/x-ffmpeg-input',
  RTCAVOffer: 'x-scrypted/x-rtc-av-offer',
  RTCAVAnswer: 'x-scrypted/x-rtc-av-answer',
}
