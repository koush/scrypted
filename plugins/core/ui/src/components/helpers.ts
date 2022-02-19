import { ScryptedDeviceType, ScryptedInterface } from "@scrypted/types";

export function typeToIcon(type) {
    switch (type) {
        case ScryptedDeviceType.Camera: return "fa-video";
        case ScryptedDeviceType.Doorbell: return "fa-bell";
        case ScryptedDeviceType.Fan: return "fa-fan";
        case ScryptedDeviceType.Light: return "fa-lightbulb";
        case ScryptedDeviceType.Switch: return "fa-toggle-on";
        case ScryptedDeviceType.Outlet: return "fa-plug";
        case ScryptedDeviceType.Sensor: return "fa-exclamation-triangle";
        case ScryptedDeviceType.Scene: return "fa-sun";
        case ScryptedDeviceType.Program: return "fa-code";
        case ScryptedDeviceType.Automation: return "fa-bolt";
        case ScryptedDeviceType.Event: return "fa-exclamation";
        case ScryptedDeviceType.Vacuum: return "fa-trash";
        case ScryptedDeviceType.Notifier: return "fa-bell";
        case ScryptedDeviceType.Lock: return "fa-unlock-alt";
        case ScryptedDeviceType.Thermostat: return "fa-thermometer-three-quarters";
        case ScryptedDeviceType.PasswordControl: return "fa-key";
        case ScryptedDeviceType.Display: return "fa-tv";
        case ScryptedDeviceType.Speaker: return "fa-volume-up";
        case ScryptedDeviceType.Entry: return "fa-warehouse";
        case ScryptedDeviceType.Garage: return "fa-warehouse";
        case ScryptedDeviceType.API: return "fa-cloud";
        case ScryptedDeviceType.DataSource: return "fa-chart-area";
        case ScryptedDeviceType.DeviceProvider: return "fa-server";
        case ScryptedDeviceType.Unknown: return "fa-question-circle";
        case ScryptedDeviceType.Valve: return "fa-faucet";
        case ScryptedDeviceType.Irrigation: return "fa-faucet";
        case ScryptedDeviceType.Person: return "fa-user";

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
            return 'fa-question';
        return typeToIcon(d.type);
    }
    return 'fa-bell';
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
        case ScryptedDeviceType.Person:
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

const interfaceFriendlyNames = new Map<ScryptedInterface, string>();
interfaceFriendlyNames.set(ScryptedInterface.MixinProvider, "Compatible Things");
interfaceFriendlyNames.set(ScryptedInterface.DeviceProvider, "Providing Things");

export function getInterfaceFriendlyName(iface: ScryptedInterface) {
    return interfaceFriendlyNames.get(iface) || iface.toString();
}