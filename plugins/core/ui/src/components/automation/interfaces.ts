import { ScryptedInterface } from '@scrypted/sdk/types';

export const actionableInterfaces = [
    ScryptedInterface.OnOff,
    ScryptedInterface.Brightness,
    ScryptedInterface.ColorSettingHsv,
    ScryptedInterface.ColorSettingRgb,
    ScryptedInterface.ColorSettingTemperature,
    ScryptedInterface.Dock,
    ScryptedInterface.Entry,
    ScryptedInterface.Lock,
    ScryptedInterface.Notifier,
    ScryptedInterface.Pause,
    ScryptedInterface.Scene,
    ScryptedInterface.SoftwareUpdate,
    ScryptedInterface.StartStop,

    // 'Timer',
    // 'Program',
    // 'Monitor',
    // 'Condition',
    // 'Javascript',
];

export const actionableEvents = [
    ScryptedInterface.OnOff,
    ScryptedInterface.Brightness,
    ScryptedInterface.ColorSettingHsv,
    ScryptedInterface.ColorSettingRgb,
    ScryptedInterface.ColorSettingTemperature,
    ScryptedInterface.Dock,
    ScryptedInterface.Entry,
    ScryptedInterface.Lock,
    ScryptedInterface.Notifier,
    ScryptedInterface.Pause,
    ScryptedInterface.StartStop,

    ScryptedInterface.Thermometer,
    ScryptedInterface.HumiditySensor,
    ScryptedInterface.BinarySensor,
    ScryptedInterface.IntrusionSensor,
    ScryptedInterface.PowerSensor,
    ScryptedInterface.AudioSensor,
    ScryptedInterface.MotionSensor,
    ScryptedInterface.OccupancySensor,
    ScryptedInterface.FloodSensor,
    ScryptedInterface.UltravioletSensor,
    ScryptedInterface.LuminanceSensor,
    ScryptedInterface.PositionSensor,

    ScryptedInterface.ObjectDetector,

    // 'FaceDetector',
    // 'Scheduler',
];
