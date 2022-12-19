import { ScryptedInterface } from '@scrypted/types';

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
    ScryptedInterface.StartStop,

    // 'Timer',
    // 'Program',
    // 'Monitor',
    // 'Condition',
    // 'Javascript',
];

export const actionableEvents = [
    ScryptedInterface.Online,
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
    ScryptedInterface.TamperSensor,
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
