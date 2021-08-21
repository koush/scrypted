import { ScryptedDeviceBase, ScryptedInterfaceDescriptors } from "@scrypted/sdk";
import sdk from "@scrypted/sdk";
const { systemManager, log } = sdk;

export interface AggregateDevice extends ScryptedDeviceBase {
    computeInterfaces(): string[];
}

export function createAggregateDevice(nativeId: string): AggregateDevice {
    class AggregateDeviceImpl extends ScryptedDeviceBase {
        constructor() {
            super(nativeId);
        }

        computeInterfaces(): string[] {
            try {
                const data = JSON.parse(this.storage.getItem('data'));

                const interfaces = new Set<string>();
                for (const deviceInterface of data.deviceInterfaces) {
                    const parts = deviceInterface.split('#');
                    const id = parts[0];
                    const iface = parts[1];

                    interfaces.add(iface);
                }

                return [...interfaces.values()];
            }
            catch (e) {
                log.e(`error loading aggregate device ${e}`);
                return [];
            }
        }
    }

    const ret = new AggregateDeviceImpl();
    try {
        const data = JSON.parse(ret.storage.getItem('data'));

        const interfaces = ret.computeInterfaces();

        for (const iface of interfaces) {
            const descriptor = ScryptedInterfaceDescriptors[iface];
            for (const method of descriptor.methods) {
                AggregateDeviceImpl.prototype[method] = async function (...args: any[]) {
                    const ret: Promise<any>[] = [];
                    for (const deviceInterface of data.deviceInterfaces) {
                        const parts = deviceInterface.split('#');
                        const id = parts[0];
                        const device = systemManager.getDeviceById(id);
                        ret.push(device[method](...args));
                    }

                    return await Promise.all(ret)[0];
                }
            }
        }
    }
    catch (e) {
        ret.log.e(`error loading aggregate device ${e}`);
        console.error(e);
    }

    return new AggregateDeviceImpl();
}