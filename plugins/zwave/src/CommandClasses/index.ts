import { ScryptedInterface } from '@scrypted/sdk';
import { CommandClasses, ValueID } from '@zwave-js/core';
import { ZWaveNode } from 'zwave-js';
import BatteryToBattery from './BatteryToBattery';
import BinarySensorToStateSensor from './BinarySensorToStateSensor';
import BrightnessToSwitchMultilevel from './BrightnessToSwitchMultilevel';
import ColorSettingRgbToColor from './ColorSettingRgbToColor';
import { EntrySensorToAccessControl } from './EntrySensorToAccessControl';
import EntrySensorToBarriorOperator from './EntrySensorToBarrierOperator';
import EntryToBarrierOperator from './EntryToBarrierOperator';
import { FloodSensorToWaterAlarm } from './FloodSensorToWaterAlarm';
import HumidityToSensorMultilevel from './HumiditySensorToSensorMultilevel';
import LockToDoorLock from './LockToDoorLock';
import LuminanceSensorToSensorMultilevel from './LuminanceSensorToSensorMultilevel';
import OnOffToSwitch from './OnOffToSwitch';
import { PasswordStoreToUserCode } from './PasswordStoreToUserCode';
import { PowerSensorToPowerManagement } from './PowerSensorToPowerManagement';
import SettingsToConfiguration from './SettingsToConfiguration';
import { SmokeAlarmToCO2Sensor } from './SmokeAlarmToBinarySensor';
import { TamperSensorToHomeSecurity } from './TamperSensorToHomeSecurity';
import ThermometerToSensorMultilevel from './ThermometerToSensorMultilevel';
import UltravioletSensorMultilevel from './UltravioletSensorToSensorMultilevel';
import { CommandClassHandler as CommandClassHandlerClass } from './ZwaveDeviceBase';

var CommandClassMap: {[ccId: string]: CommandClassInfo} = {};

export class CommandClassInfo {
    handlerClass: CommandClassHandlerClass;
    interfaces: string[];

    getInterfaces(node: ZWaveNode, valueId: ValueID): string[] {
        if (this.handlerClass.getInterfaces) {
            return this.handlerClass.getInterfaces(node, valueId);
        }
        return this.interfaces;
    }
}

function addCommandClassIndex(commandClass: number, property: string|number, handlerClass: CommandClassHandlerClass, ...interfaces: string[]) {
    var cc: CommandClassInfo = new CommandClassInfo();

    var valueId: ValueID = {
        commandClass,
        property,
    };
    handlerClass.valueId = valueId;

    cc.handlerClass = handlerClass;
    cc.interfaces = interfaces;
    CommandClassMap[`${commandClass}#${property}`] = cc;
}

function addCommandClass(commandClass: number, handlerClass: CommandClassHandlerClass, ...interfaces: string[]) {
    var cc: CommandClassInfo = new CommandClassInfo();

    var valueId: ValueID = {
        commandClass,
        property: null,
    };
    handlerClass.valueId = valueId;

    cc.handlerClass = handlerClass;
    cc.interfaces = interfaces;
    CommandClassMap[`${commandClass}`] = cc;
}

export function getCommandClass(commandClass: number): CommandClassInfo {
    return CommandClassMap[`${commandClass}`];
}

export function getCommandClassIndex(commandClass: number, index: number): CommandClassInfo {
    return CommandClassMap[`${commandClass}#${index}`];
}

addCommandClassIndex(CommandClasses['Binary Switch'], 'currentValue', OnOffToSwitch, ScryptedInterface.OnOff);
addCommandClassIndex(CommandClasses['Multilevel Switch'], 'currentValue', BrightnessToSwitchMultilevel, ScryptedInterface.Brightness, ScryptedInterface.OnOff);
addCommandClassIndex(CommandClasses['Color'], 'currentValue', ColorSettingRgbToColor, ScryptedInterface.ColorSettingRgb, ScryptedInterface.ColorSettingTemperature);
addCommandClassIndex(CommandClasses['Binary Sensor'], 'Any', BinarySensorToStateSensor, ScryptedInterface.BinarySensor);
addCommandClassIndex(CommandClasses['Door Lock'], 'currentMode', LockToDoorLock, ScryptedInterface.Lock);
addCommandClassIndex(CommandClasses['Battery'], 'level', BatteryToBattery, ScryptedInterface.Battery);
addCommandClassIndex(CommandClasses['Entry Control'], 'currentValue', EntryToBarrierOperator, ScryptedInterface.Entry);
addCommandClassIndex(CommandClasses['Multilevel Sensor'], 'Air temperature', ThermometerToSensorMultilevel, ScryptedInterface.Thermometer);
addCommandClassIndex(CommandClasses['Multilevel Sensor'], 'Humidity', HumidityToSensorMultilevel, ScryptedInterface.HumiditySensor);
addCommandClassIndex(CommandClasses['Multilevel Sensor'], 'Illuminance', LuminanceSensorToSensorMultilevel, ScryptedInterface.LuminanceSensor);
addCommandClassIndex(CommandClasses['Multilevel Sensor'], 'Ultraviolet', UltravioletSensorMultilevel, ScryptedInterface.UltravioletSensor);

addCommandClassIndex(CommandClasses['Notification'], 'Access Control', EntrySensorToAccessControl, ScryptedInterface.EntrySensor);
addCommandClassIndex(CommandClasses['Notification'], 'Water Alarm', FloodSensorToWaterAlarm, ScryptedInterface.FloodSensor);
addCommandClassIndex(CommandClasses['Notification'], 'Home Security', TamperSensorToHomeSecurity, ScryptedInterface.TamperSensor);
addCommandClassIndex(CommandClasses['Notification'], 'Power Management', PowerSensorToPowerManagement, ScryptedInterface.PowerSensor);
addCommandClassIndex(CommandClasses['Notification'], 'Smoke Alarm', SmokeAlarmToCO2Sensor, ScryptedInterface.CO2Sensor);

addCommandClassIndex(CommandClasses['Barrier Operator'], 'currentState', EntryToBarrierOperator, ScryptedInterface.Entry);
addCommandClassIndex(CommandClasses['Barrier Operator'], 'position', EntrySensorToBarriorOperator, ScryptedInterface.EntrySensor);

addCommandClass(CommandClasses['Configuration'], SettingsToConfiguration, ScryptedInterface.Settings);
addCommandClass(CommandClasses['User Code'], PasswordStoreToUserCode, ScryptedInterface.PasswordStore);
