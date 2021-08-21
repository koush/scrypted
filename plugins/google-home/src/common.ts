import { Battery, ScryptedDevice, ScryptedDeviceType, ScryptedInterface } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import type { SmartHomeV1ExecuteResponseCommands, SmartHomeV1SyncDevices } from 'actions-on-google/dist/service/smarthome/api/v1';

const { systemManager } = sdk;

export interface DummyDevice {
    interfaces?: string[];
    type?: ScryptedDeviceType;
}

interface SupportedType {
    type: ScryptedDeviceType;
    probe(device: DummyDevice): boolean;
    getSyncResponse: (device: ScryptedDevice & any) => Promise<SmartHomeV1SyncDevices>;
    query: (device: ScryptedDevice & any) => Promise<any>;
}

export const supportedTypes: { [type: string]: SupportedType } = {};

export function addSupportedType(type: SupportedType) {
    supportedTypes[type.type] = type;
}

export function syncResponse(device: ScryptedDevice, type: string): SmartHomeV1SyncDevices {
    const ret: SmartHomeV1SyncDevices = {
        id: device.id,
        name: {
            name: device.name,
            defaultNames: [],
            nicknames: [],
        },
        otherDeviceIds: [
            {
                deviceId: device.id,
            }
        ],
        attributes: {},
        traits: [],
        type,
        willReportState: true,
    }

    if (device.interfaces.includes(ScryptedInterface.Battery)) {
        ret.traits.push('action.devices.traits.EnergyStorage');
        ret.attributes.queryOnlyEnergyStorage = true;
    }

    return ret;
}

export function executeResponse(device: ScryptedDevice): SmartHomeV1ExecuteResponseCommands {
    return {
        ids: [device.id],
        status: 'SUCCESS',
    }
}

function capacityToDescription(device: Battery): string {
    if (device.batteryLevel > 98)
        return 'FULL';
    if (device.batteryLevel > 80)
        return 'HIGH';
    if (device.batteryLevel > 40)
        return 'MEDIUM';
    if (device.batteryLevel > 20)
        return 'LOW';
    return 'CRITICALLY_LOW';
}

export function queryResponse(device: ScryptedDevice & Battery): any {
    const ret: any = {};

    if (device.interfaces.includes(ScryptedInterface.Battery)) {
        ret.descriptiveCapacityRemaining = capacityToDescription(device);
        ret.capacityRemaining = [
            {
                unit: 'PERCENTAGE',
                rawValue: device.batteryLevel,
            }
        ]
    }

    return ret;
}