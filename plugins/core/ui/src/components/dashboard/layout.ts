import { SystemManager, ScryptedDeviceType, ScryptedDevice, ScryptedInterface, Setting } from "@scrypted/types";
import DashboardMap from "./DashboardMap.vue";
import DashboardToggle from "./DashboardToggle.vue";
import DashboardCamera from "./DashboardCamera.vue";
import DashboardLock from "./DashboardLock.vue";
import DashboardThermostat from "./DashboardThermostat.vue";
import DashboardStartStop from "./DashboardStartStop.vue";
import DashboardMediaPlayer from "./DashboardMediaPlayer.vue";
import { Multimap, EnsureMap } from "./multimap";

export interface Card {
    name: string;
    components: CardComponent[];
    height: number;
    color: string;
    state?: any;
}

export interface CardComponent {
    component: string;
    value: any;
    state?: any;
}

interface CardComponentInternal extends CardComponent {
    priority: number;
}

interface CardComponentTypeOptions {
    cardName?: string;
}

class CardComponentType {
    priority: number;
    collapse: boolean;
    type: ScryptedDeviceType;
    requiresAnyInterface: Set<string>;
    height: number;
    component: any;
    cardName: string | undefined;

    constructor(type: ScryptedDeviceType, priority: number, collapse: boolean, height: number, component: any, options: CardComponentTypeOptions, ...requiresAnyInterface: ScryptedInterface[]) {
        Object.assign(this, options);
        this.component = component;
        this.type = type;
        this.priority = priority;
        this.collapse = collapse;
        this.height = height;
        this.requiresAnyInterface = new Set(requiresAnyInterface);
    }

    supports(device: ScryptedDevice): boolean {
        if (device.type !== this.type) {
            return false;
        }

        for (const iface of device.interfaces) {
            if (this.requiresAnyInterface.has(iface)) {
                return true;
            }
        }
        return false;
    }

    create(name: string, devices: ScryptedDevice[]): CardComponentInternal[] {
        if (this.collapse) {
            return [{
                component: this.component.name,
                priority: this.priority,
                value: {
                    name,
                    type: this.type,
                    deviceIds: devices.map(device => device.id),
                }
            }];
        }

        return devices.map(device => ({
            component: this.component.name,
            priority: this.priority,
            value: {
                name: device.name,
                type: this.type,
                deviceId: device.id,
            }
        }));
    }

    clone(): CardComponentType {
        const ret = new CardComponentType(this.type, this.priority, this.collapse, this.height, this.component, {
            cardName: this.cardName,
        }, ...[]);
        ret.requiresAnyInterface = this.requiresAnyInterface;
        return ret;
    }

    getCardName(cardName: string): string {
        return this.cardName || cardName || uncategorized;
    }
}

function pluralize(type): string {
    switch (type) {
        case ScryptedDeviceType.Light:
            return "Lights";
        case ScryptedDeviceType.Fan:
            return "Fans";
        case ScryptedDeviceType.Outlet:
            return "Outlets";
        case ScryptedDeviceType.Switch:
            return "Switches";
        case ScryptedDeviceType.Lock:
            return "Locks";
        case ScryptedDeviceType.Camera:
            return "Cameras";
        case ScryptedDeviceType.Thermostat:
            return "Thermostats";
        case ScryptedDeviceType.Sensor:
            return "Sensors";
    }
    return type;
}

const uncategorized = "Uncategorized";
const cardComponentTypes: CardComponentType[] = [];

for (const type of [ScryptedDeviceType.Light, ScryptedDeviceType.Outlet, ScryptedDeviceType.Switch, ScryptedDeviceType.Fan]) {
    cardComponentTypes.push(new CardComponentType(type, 30, true, 1, DashboardToggle, undefined, ScryptedInterface.OnOff));
}
cardComponentTypes.push(new CardComponentType(ScryptedDeviceType.Sensor, 0, true, 6, DashboardMap, { cardName: "Map" }, ScryptedInterface.PositionSensor));
cardComponentTypes.push(new CardComponentType(ScryptedDeviceType.Camera, 0, false, 4, DashboardCamera, undefined, ScryptedInterface.Camera, ScryptedInterface.VideoCamera));
cardComponentTypes.push(new CardComponentType(ScryptedDeviceType.Doorbell, 0, false, 4, DashboardCamera, undefined, ScryptedInterface.Camera, ScryptedInterface.VideoCamera));
cardComponentTypes.push(new CardComponentType(ScryptedDeviceType.Lock, 15, false, 1, DashboardLock, undefined, ScryptedInterface.Lock));
cardComponentTypes.push(new CardComponentType(ScryptedDeviceType.Thermostat, 20, false, 1, DashboardThermostat, undefined, ScryptedInterface.TemperatureSetting));
cardComponentTypes.push(new CardComponentType(ScryptedDeviceType.Vacuum, 10, false, 1, DashboardStartStop, undefined, ScryptedInterface.StartStop));
cardComponentTypes.push(new CardComponentType(ScryptedDeviceType.Speaker, 5, false, 8, DashboardMediaPlayer, undefined, ScryptedInterface.MediaPlayer));
cardComponentTypes.push(new CardComponentType(ScryptedDeviceType.Display, 5, false, 8, DashboardMediaPlayer, undefined, ScryptedInterface.MediaPlayer));

const cardComponentSettings: Map<string, Setting[]> = new Map();
{
    cardComponentSettings.set(DashboardToggle.name, [
        {
            title: "Label",
            key: "name",
            value: "New Toggle",
        },
        {
            title: "Icon",
            key: "type",
            choices: [ScryptedDeviceType.Light, ScryptedDeviceType.Outlet, ScryptedDeviceType.Switch, ScryptedDeviceType.Fan]
        },
        {
            title: "Toggle Devices",
            key: "deviceIds",
            type: 'device',
            multiple: true,
            deviceFilter: `${JSON.stringify([ScryptedDeviceType.Light, ScryptedDeviceType.Outlet, ScryptedDeviceType.Switch, ScryptedDeviceType.Fan])}.includes(type) && interfaces.includes(${JSON.stringify(ScryptedInterface.OnOff)})`,
            value: JSON.stringify([]),
        }
    ]);

    cardComponentSettings.set(DashboardMap.name, [
        {
            title: "Position Devices",
            key: "deviceIds",
            type: 'device',
            multiple: true,
            deviceFilter: `${JSON.stringify(ScryptedDeviceType.Sensor)} === type && interfaces.includes(${JSON.stringify(ScryptedInterface.PositionSensor)})`,
            value: JSON.stringify([]),
        }
    ]);

    cardComponentSettings.set(DashboardCamera.name, [
        {
            title: "Camera Device",
            key: "deviceId",
            type: 'device',
            deviceFilter: `(${JSON.stringify(ScryptedDeviceType.Camera)} === type || ${JSON.stringify(ScryptedDeviceType.Doorbell)} === type) && (interfaces.includes(${JSON.stringify(ScryptedInterface.Camera)}) || interfaces.includes(${JSON.stringify(ScryptedInterface.VideoCamera)}))`,
            value: null,
        }
    ]);

    cardComponentSettings.set(DashboardLock.name, [
        {
            title: "Custom Label",
            key: "name",
            value: "",
        },
        {
            title: "Lock Device",
            key: "deviceId",
            type: 'device',
            deviceFilter: `${JSON.stringify(ScryptedDeviceType.Lock)} === type && interfaces.includes(${JSON.stringify(ScryptedInterface.Lock)})`,
            value: null,
        }
    ]);

    cardComponentSettings.set(DashboardThermostat.name, [
        {
            title: "Custom Label",
            key: "name",
            value: "",
        },
        {
            title: "Themostat Device",
            key: "deviceId",
            type: 'device',
            deviceFilter: `${JSON.stringify(ScryptedDeviceType.Thermostat)} === type && interfaces.includes(${JSON.stringify(ScryptedInterface.TemperatureSetting)})`,
            value: null,
        }
    ]);

    cardComponentSettings.set(DashboardStartStop.name, [
        {
            title: "Custom Label",
            key: "name",
            value: "",
        },
        {
            title: "Vacuum Device",
            key: "deviceId",
            type: 'device',
            deviceFilter: `${JSON.stringify(ScryptedDeviceType.Vacuum)} === type && interfaces.includes(${JSON.stringify(ScryptedInterface.StartStop)})`,
            value: null,
        }
    ]);


    cardComponentSettings.set(DashboardMediaPlayer.name, [
        {
            title: "Custom Label",
            key: "name",
            value: "",
        },
        {
            title: "Media Player",
            key: "deviceId",
            type: 'device',
            deviceFilter: `${JSON.stringify([ScryptedDeviceType.Speaker, ScryptedDeviceType.Display])}.includes(type) && (interfaces.includes(${JSON.stringify(ScryptedInterface.MediaPlayer)}) || interfaces.includes(${JSON.stringify(ScryptedInterface.VideoCamera)}))`,
            value: null,
        }
    ]);

}

export function getCardComponentSettings(): Map<string, Setting[]> {
    return cardComponentSettings;
}

export function getDefaultDashboard(deviceIds: string[], systemManager: SystemManager): Card[] {
    const supportedTypes: Map<ScryptedDevice, CardComponentType> = new Map();
    function supports(device: ScryptedDevice): boolean {
        for (const cardComponentType of cardComponentTypes) {
            if (cardComponentType.supports(device)) {
                supportedTypes.set(device, cardComponentType.collapse ? cardComponentType : cardComponentType.clone());
                return true;
            }
        }
        return false;
    }

    // get devices, filter out unsupported
    let devices: ScryptedDevice[] = deviceIds
        .map(device => systemManager.getDeviceById(device))
        .filter(device => supports(device));

    // map devices into rooms/types.
    const rooms: EnsureMap<string, Multimap<CardComponentType, ScryptedDevice>> = new EnsureMap(() => new Multimap());
    devices.forEach(device => {
        const supportedType = supportedTypes.get(device);
        rooms.ensure(supportedType.getCardName(device.room)).add(supportedType, device)
    });

    devices = [];

    // remove rooms that don't have enough stuff in them.
    for (const [room, roomTypes] of rooms.entries()) {
        if (roomTypes.size <= 2) {
            rooms.delete(room);
            for (const roomTypeDevices of roomTypes.values()) {
                devices.push(...roomTypeDevices);
            }
        }
    }

    const types: EnsureMap<string, Multimap<string, ScryptedDevice>> = new EnsureMap(() => new Multimap());
    devices.forEach(device => {
        const supportedType = supportedTypes.get(device);
        // use the card name override when grouping by type
        const cardName = supportedType.getCardName(supportedType.type);
        types.ensure(cardName).add(supportedType.getCardName(device.room), device)
    });

    const ret: Card[] = [];
    for (const [room, roomTypes] of rooms.entries()) {
        const components: CardComponentInternal[] = [];
        let height = 0;
        for (const [roomType, roomTypeDevices] of roomTypes.entries()) {
            // type needs to be specific, since we're grouped by room
            components.push(...roomType.create(`${pluralize(roomType.type)}`, roomTypeDevices));
            height += roomType.height;
        }
        components.sort((a, b) => a.priority - b.priority);

        const card: Card = {
            name: room,
            components,
            height,
            color: 'light-blue darken-2',
        }
        ret.push(card);
    }

    for (const [type, typeRooms] of types.entries()) {
        const components: CardComponentInternal[] = [];
        let height = 0;

        for (const [room, roomDevices] of typeRooms.entries()) {
            // room needs to be specific, since we're grouped by type
            const supportedType = supportedTypes.get(roomDevices[0]);
            components.push(...supportedType.create(`${room}`, roomDevices));
            height += supportedType.height;
        }
        components.sort((a, b) => a.priority - b.priority);

        const card: Card = {
            name: pluralize(type),
            components,
            height,
            color: 'light-blue darken-2',
        }
        ret.push(card);
    }

    return ret;
}