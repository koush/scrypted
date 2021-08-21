import { ScryptedDeviceType, ScryptedInterface, ScryptedInterfaceProperty } from "@scrypted/sdk/types";
import { PluginDevice } from "./plugin/plugin-device";
import { getState } from "./state";

const inferenceTable: {[iface: string]: ScryptedDeviceType[]} = {};

function addType(iface: ScryptedInterface, ...type: ScryptedDeviceType[]) {
    let entries = inferenceTable[iface];
    if (!entries) {
        entries = [];
        inferenceTable[iface] = entries;
    }
    entries.push(...type);
}

addType(ScryptedInterface.MediaPlayer, ScryptedDeviceType.Display);
addType(ScryptedInterface.MediaPlayer, ScryptedDeviceType.Speaker);

addType(ScryptedInterface.ColorSettingHsv, ScryptedDeviceType.Light);
addType(ScryptedInterface.ColorSettingRgb, ScryptedDeviceType.Light);
addType(ScryptedInterface.ColorSettingTemperature, ScryptedDeviceType.Light);
addType(ScryptedInterface.VideoCamera, ScryptedDeviceType.Camera);
addType(ScryptedInterface.OnOff, ScryptedDeviceType.Light);
addType(ScryptedInterface.Brightness, ScryptedDeviceType.Light);
addType(ScryptedInterface.StartStop, ScryptedDeviceType.Vacuum);
addType(ScryptedInterface.Dock, ScryptedDeviceType.Vacuum);
addType(ScryptedInterface.Scene, ScryptedDeviceType.Scene);
addType(ScryptedInterface.TemperatureSetting, ScryptedDeviceType.Thermostat);
addType(ScryptedInterface.Lock, ScryptedDeviceType.Lock);
addType(ScryptedInterface.Entry, ScryptedDeviceType.Entry, ScryptedDeviceType.Garage);
addType(ScryptedInterface.Notifier, ScryptedDeviceType.Notifier, ScryptedDeviceType.Speaker, ScryptedDeviceType.Display);
addType(ScryptedInterface.PasswordStore, ScryptedDeviceType.PasswordControl);
addType(ScryptedInterface.BinarySensor, ScryptedDeviceType.Sensor);
addType(ScryptedInterface.HttpRequestHandler, ScryptedDeviceType.API);
addType(ScryptedInterface.HttpRequestHandler, ScryptedDeviceType.DataSource);
addType(ScryptedInterface.BufferConverter, ScryptedDeviceType.API);
addType(ScryptedInterface.DeviceProvider, ScryptedDeviceType.DeviceProvider);

export function inferTypeFromInterfaces(interfaces: ScryptedInterface[]): ScryptedDeviceType {
    return inferTypesFromInterfaces(interfaces)[0];
}

export function inferTypesFromInterfaces(interfaces: ScryptedInterface[]): ScryptedDeviceType[] {
    const types = Object.keys(inferenceTable).filter(iface => interfaces.includes(iface as ScryptedInterface)).map(iface => inferenceTable[iface]).flat();
    return types;
}

export function getProvidedNameOrDefault(pluginDevice: PluginDevice): string {
    const providedName = getState(pluginDevice, ScryptedInterfaceProperty.providedName);
    if (providedName)
        return providedName;
    const type = getProvidedTypeOrDefault(pluginDevice);
    return `New ${type}`;
}

export function getDisplayName(pluginDevice: PluginDevice): string {
    const name = getState(pluginDevice, ScryptedInterfaceProperty.name);
    if (name)
        return name;
    return getProvidedNameOrDefault(pluginDevice);
}

export function getProvidedTypeOrDefault(pluginDevice: PluginDevice): ScryptedDeviceType {
    const providedType = getState(pluginDevice, ScryptedInterfaceProperty.providedType);
    if (providedType)
        return providedType;
    const type = inferTypeFromInterfaces(getState(pluginDevice, ScryptedInterfaceProperty.interfaces) || []) || ScryptedDeviceType.Unknown;
    return type;
}

export function getDisplayType(pluginDevice: PluginDevice): ScryptedDeviceType {
    const type = getState(pluginDevice, ScryptedInterfaceProperty.type);
    if (type)
        return type;
    return getProvidedTypeOrDefault(pluginDevice);
}

const roomHints: { [hint: string]: string } = {
    'Exterior': 'Exterior',
    'Backyard': 'Exterior',
    'Front Yard': 'Exterior',
    'Back Yard': 'Exterior',
    'Basement': 'Basement',
    'Den': 'Den',
    'Dining': 'Dining Room',
    'Entry': 'Entryway',
    'Family': 'Family Room',
    'Gym': 'Gym',
    'Garage': 'Garage',
    'Guest': 'Guest Bedroom',
    'Kitchen': 'Kitchen',
    'Living': 'Living Room',
    'Master': 'Master Bedroom',
    'Office': 'Office',
    'Powder': 'Powder Room',
    'Laundry': 'Laundry Room',
}

export function inferRoomFromName(name: string): string {
    if (!name)
        return;
    for (const hint of Object.keys(roomHints)) {
        if (name.includes(hint))
            return roomHints[hint];
    }
}

export function getProvidedRoomOrDefault(pluginDevice: PluginDevice): string {
    const providedRoom = getState(pluginDevice, ScryptedInterfaceProperty.providedRoom);
    if (providedRoom)
        return providedRoom;
    const room = inferRoomFromName(getDisplayName(pluginDevice));
    return room;
}

export function getDisplayRoom(pluginDevice: PluginDevice): string {
    const room = getState(pluginDevice, ScryptedInterfaceProperty.room);
    if (room)
        return room;
    return getProvidedRoomOrDefault(pluginDevice);
}
