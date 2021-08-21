import { ScryptedDeviceType, ScryptedInterface } from "@scrypted/sdk/types";

export function typeToIcon(type) {
    switch (type) {
        case ScryptedDeviceType.Camera: return "video";
        case ScryptedDeviceType.Doorbell: return "bell";
        case ScryptedDeviceType.Fan: return "angle-double-right";
        case ScryptedDeviceType.Light: return "lightbulb";
        case ScryptedDeviceType.Switch: return "toggle-on";
        case ScryptedDeviceType.Outlet: return "plug";
        case ScryptedDeviceType.Sensor: return "exclamation-triangle";
        case ScryptedDeviceType.Scene: return "sun";
        case ScryptedDeviceType.Program: return "code";
        case ScryptedDeviceType.Automation: return "bolt";
        case ScryptedDeviceType.Event: return "exclamation";
        case ScryptedDeviceType.Vacuum: return "trash";
        case ScryptedDeviceType.Notifier: return "bell";
        case ScryptedDeviceType.Lock: return "unlock-alt";
        case ScryptedDeviceType.Thermostat: return "thermometer-three-quarters";
        case ScryptedDeviceType.PasswordControl: return "key";
        case ScryptedDeviceType.Display: return "tv";
        case ScryptedDeviceType.Speaker: return "volume-up";
        case ScryptedDeviceType.Entry: return "warehouse";
        case ScryptedDeviceType.Garage: return "warehouse";
        case ScryptedDeviceType.API: return "cloud";
        case ScryptedDeviceType.DataSource: return "chart-area";
        case ScryptedDeviceType.DeviceProvider: return "server";
        case ScryptedDeviceType.Unknown: return "question-circle";

    }
    return "toggle-on";
}

export function getComponentName(id: string) {
    switch (id) {
        case "script":
            return "Plugins";
        case "aggregate":
            return "Device Groups";
        case "mail":
            return "Incoming Mail";
        case "webpush":
            return "Web Push Notifier";
        case "automation":
            return "Automations";
    }
    return "Unknown Component";
}

export function getComponentWebPath(id) {
    return `/web/component/${id}`;
}

export function getDeviceViewPath(id) {
    return `/device/${id}`;
}

export function getComponentViewPath(id) {
    return `/component/${id}`;
}

export async function removeAlert(alert) {
    const alerts = await this.$scrypted.systemManager.getComponent('alerts');
    await alerts.removeAlert(alert);
    this.$store.commit("removeAlert", alert._id);
}

export function getAlertIcon(alert) {
    const device = '/device/';
    if (alert.path.startsWith(device)) {
        const id = alert.path.replace(device, '');
        const d = this.$scrypted.systemManager.getDeviceById(id);
        if (!d)
            return 'question';
        return typeToIcon(d.type);
    }
    return 'bell';
}

export function hasFixedPhysicalLocation(type: ScryptedDeviceType, interfaces?: ScryptedInterface[]): boolean {
    // prevent unused.
    interfaces;
    switch (type) {
        case ScryptedDeviceType.Builtin:
        case ScryptedDeviceType.Program:
        case ScryptedDeviceType.Automation:
        case ScryptedDeviceType.API:
        case ScryptedDeviceType.Scene:
        case ScryptedDeviceType.Event:
        case ScryptedDeviceType.DeviceProvider:
        case ScryptedDeviceType.DataSource:
            return false;
    }
    return true;
}

interface Inference {
    type: ScryptedDeviceType,
    interfaces: ScryptedInterface[];
}
const inference: Inference[] = [];

function addInference(type: ScryptedDeviceType, ...interfaces: ScryptedInterface[]) {
    inference.push({
        type,
        interfaces,
    })
}

// in order of least ambiguous to most ambiguous
addInference(ScryptedDeviceType.Display, ScryptedInterface.MediaPlayer);
addInference(ScryptedDeviceType.Speaker, ScryptedInterface.MediaPlayer);

addInference(ScryptedDeviceType.Lock, ScryptedInterface.Lock);
addInference(ScryptedDeviceType.PasswordControl, ScryptedInterface.PasswordStore);
addInference(ScryptedDeviceType.Camera, ScryptedInterface.Camera);
addInference(ScryptedDeviceType.Camera, ScryptedInterface.VideoCamera);
addInference(ScryptedDeviceType.Doorbell, ScryptedInterface.VideoCamera);
addInference(ScryptedDeviceType.Thermostat, ScryptedInterface.TemperatureSetting);
addInference(ScryptedDeviceType.Garage, ScryptedInterface.Entry);
addInference(ScryptedDeviceType.Entry, ScryptedInterface.Entry);

addInference(ScryptedDeviceType.Light, ScryptedInterface.Brightness);

addInference(ScryptedDeviceType.Outlet, ScryptedInterface.OnOff);
addInference(ScryptedDeviceType.Switch, ScryptedInterface.OnOff);
addInference(ScryptedDeviceType.Light, ScryptedInterface.OnOff);
addInference(ScryptedDeviceType.Fan, ScryptedInterface.OnOff);

addInference(ScryptedDeviceType.Sensor, ScryptedInterface.Thermometer);

addInference(ScryptedDeviceType.DeviceProvider, ScryptedInterface.DeviceProvider);

function checkSubset(set: ScryptedInterface[], subset: ScryptedInterface[]) {
    for (const i of subset) {
        if (!set.includes(i))
            return false;
    }

    return true;
}

export function inferTypesFromInterfaces(existingType: ScryptedDeviceType, providedType: ScryptedDeviceType, interfaces: ScryptedInterface[]): ScryptedDeviceType[] {
    if (providedType === ScryptedDeviceType.Unknown) {
        return Object.values(ScryptedDeviceType).filter(t => t !== ScryptedDeviceType.Builtin);
    }
    const ret: Set<ScryptedDeviceType> = new Set();
    if (existingType)
        ret.add(existingType);
    if (providedType)
        ret.add(providedType);
    inference.filter(i => checkSubset(interfaces, i.interfaces)).forEach(i => ret.add(i.type));

    for (const iface of interfaces) {
        if (iface.indexOf("Sensor") !== -1) {
            ret.add(ScryptedDeviceType.Sensor);
        }
    }

    return [...ret];
}

export function isSyncable(type: ScryptedDeviceType) {
    if (hasFixedPhysicalLocation(type)) {
        return true;
    }
    switch (type) {
        case ScryptedDeviceType.Scene:
            return true;
        // more?
    }
    return false;
}
