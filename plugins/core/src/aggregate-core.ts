import sdk, { Device, DeviceCreator, DeviceCreatorSettings, DeviceProvider, Readme, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting } from '@scrypted/sdk';
import { AggregateDevice } from './aggregate';

const { deviceManager } = sdk;
export const AggregateCoreNativeId = 'aggregatecore';

export class AggregateCore extends ScryptedDeviceBase implements DeviceProvider, DeviceCreator, Readme {
    aggregate = new Map<string, AggregateDevice>();

    constructor() {
        super(AggregateCoreNativeId);

        this.systemDevice = {
            deviceCreator: 'Device Group',
        };
    }

    async getReadmeMarkdown(): Promise<string> {
        return "Combine multiple devices into a single virtual device. Commands sent to the device group will be sent to all the devices in that group.";
    }

    async getCreateDeviceSettings(): Promise<Setting[]> {
        return [
            {
                key: 'name',
                title: 'Name',
                description: 'The name or description of the new device group.',
            },
        ]
    }

    async createDevice(settings: DeviceCreatorSettings): Promise<string> {
        const { name } = settings;
        const nativeId = `aggregate:${Math.random()}`;
        await this.reportAggregate(nativeId, [], name?.toString());
        const aggregate = new AggregateDevice(this, nativeId);
        aggregate.computeInterfaces();
        this.aggregate.set(nativeId, aggregate);
        return nativeId;
    }

    async reportAggregate(nativeId: string, interfaces: string[], name: string) {
        const device: Device = {
            providerNativeId: AggregateCoreNativeId,
            name,
            nativeId,
            type: ScryptedDeviceType.Unknown,
            interfaces: [ScryptedInterface.Settings, ...interfaces],
        }
        await deviceManager.onDeviceDiscovered(device);
    }

    async getDevice(nativeId: string) {
        let device = this.aggregate.get(nativeId);
        if (device)
            return device;
        device = new AggregateDevice(this, nativeId);
        device.computeInterfaces();
        this.aggregate.set(nativeId, device);
        return device;
    }

    async releaseDevice(id: string, nativeId: string): Promise<void> {
        const device = this.aggregate.get(nativeId);
        device?.release();
    }
}
