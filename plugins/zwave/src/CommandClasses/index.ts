import OnOffToSwitch from './OnOffToSwitch';
import BrightnessToSwitchMultilevel from './BrightnessToSwitchMultilevel';
import { CommandClassHandler as CommandClassHandlerClass } from './ZwaveDeviceBase';
import BinarySensorToStateSensor from './BinarySensorToStateSensor';
import LockToDoorLock from './LockToDoorLock';
import BatteryToBattery from './BatteryToBattery';
import ThermometerToSensorMultilevel from './ThermometerToSensorMultilevel';
import HumidityToSensorMultilevel from './HumiditySensorToSensorMultilevel';
import LuminanceSensorToSensorMultilevel from './LuminanceSensorToSensorMultilevel';
import UltravioletSensorMultilevel from './UltravioletSensorToSensorMultilevel';
import SettingsToConfiguration from './SettingsToConfiguration';
import EntryToBarrierOperator from './EntryToBarrierOperator';
import ColorSettingRgbToColor from './ColorSettingRgbToColor';
import { NotificationType } from './Notification';
import { EntrySensorToAccessControl } from './EntrySensorToAccessControl';
import { FloodSensorToWaterAlarm } from './FloodSensorToWaterAlarm';
import { PasswordStoreToUserCode } from './PasswordStoreToUserCode';
import { IntrusionSensorToHomeSecurity } from './IntrusionSensorToHomeSecurity';
import { PowerSensorToPowerManagement } from './PowerSensorToPowerManagement';
import { ZWaveNode } from 'zwave-js';
import {CommandClasses, ValueID} from '@zwave-js/core'

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

addCommandClassIndex(CommandClasses['Binary Switch'], 'currentValue', OnOffToSwitch, 'OnOff');
addCommandClassIndex(CommandClasses['Multilevel Switch'], 'currentValue', BrightnessToSwitchMultilevel, 'Brightness', 'OnOff');
addCommandClassIndex(CommandClasses['Color'], 'currentValue', ColorSettingRgbToColor, 'ColorSettingRgb', 'ColorSettingTemperature');
addCommandClassIndex(CommandClasses['Binary Sensor'], 'Any', BinarySensorToStateSensor, 'BinarySensor');
addCommandClassIndex(CommandClasses['Door Lock'], 'currentMode', LockToDoorLock, 'Lock');
addCommandClassIndex(CommandClasses['Battery'], 'level', BatteryToBattery, 'Battery');
addCommandClassIndex(CommandClasses['Entry Control'], 'currentValue', EntryToBarrierOperator, 'Entry');
addCommandClassIndex(CommandClasses['Multilevel Sensor'], 'Air temperature', ThermometerToSensorMultilevel, 'Thermometer');
addCommandClassIndex(CommandClasses['Multilevel Sensor'], 'Humidity', HumidityToSensorMultilevel, 'HumiditySensor');
addCommandClassIndex(CommandClasses['Multilevel Sensor'], 'Illuminance', LuminanceSensorToSensorMultilevel, 'LuminanceSensor');
addCommandClassIndex(CommandClasses['Multilevel Sensor'], 'Ultraviolet', UltravioletSensorMultilevel, 'UltravioletSensor');

addCommandClassIndex(CommandClasses['Notification'], 'Access Control', EntrySensorToAccessControl, 'EntrySensor');
addCommandClassIndex(CommandClasses['Notification'], 'Water Alarm', FloodSensorToWaterAlarm, 'FloodSensor');
addCommandClassIndex(CommandClasses['Notification'], 'Home Security', IntrusionSensorToHomeSecurity, 'IntrusionSensor');
addCommandClassIndex(CommandClasses['Notification'], 'Power Management', PowerSensorToPowerManagement, 'PowerSensor');

addCommandClass(CommandClasses['Configuration'], SettingsToConfiguration, 'Settings');
addCommandClass(CommandClasses['User Code'], PasswordStoreToUserCode, 'PasswordStore');
