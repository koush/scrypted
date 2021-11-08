export interface ScryptedInterfaceDescriptor {
    name: string;
    properties: string[];
    methods: string[];
}

export const ScryptedInterfaceDescriptors: { [scryptedInterface: string]: ScryptedInterfaceDescriptor } = {
    ScryptedDevice: {
        name: "ScryptedDevice",
        properties: [
            "id",
            "interfaces",
            "mixins",
            "info",
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
            "thermostatActiveMode",
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
            "getVideoStreamOptions",
        ]
    },
    Intercom: {
        name: "Intercom",
        properties: [
        ],
        methods: [
            "startIntercom",
            "stopIntercom",
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
            "audioDetected",
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
            "releaseMixin",
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
    Program: {
        name: "Program",
        properties: [
        ],
        methods: [
            "run",
        ]
    },
    Scriptable: {
        name: "Scriptable",
        properties: [
        ],
        methods: [
            "saveScript",
            "loadScripts",
            "eval",
        ]
    },
    ObjectDetector: {
        name: "ObjectDetector",
        properties: [
        ],
        methods: [
            "getDetectionInput",
            "getObjectTypes",
        ]
    },
    HumiditySetting: {
        name: "HumiditySetting",
        properties: [
            "humiditySetting",
        ],
        methods: [
            "setHumidity",
        ]
    },
    Fan: {
        name: "Fan",
        properties: [
            "fan",
        ],
        methods: [
            "setFan",
        ],
    }
} as any;
