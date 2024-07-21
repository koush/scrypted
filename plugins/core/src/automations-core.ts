import sdk, { Device, DeviceCreator, DeviceCreatorSettings, DeviceProvider, Readme, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting } from '@scrypted/sdk';
import { randomBytes } from "crypto";
import { Automation } from "./automation";
import { updatePluginsData } from './update-plugins';

const { deviceManager } = sdk;
export const AutomationCoreNativeId = 'automationcore';

export class AutomationCore extends ScryptedDeviceBase implements DeviceProvider, DeviceCreator, Readme {
    automations = new Map<string, Automation>();

    constructor() {
        super(AutomationCoreNativeId);

        this.systemDevice = {
            deviceCreator: 'Automation',
        };

        for (const nativeId of deviceManager.getNativeIds()) {
            if (nativeId?.startsWith('automation:')) {
                const automation = new Automation(nativeId);
                this.automations.set(nativeId, automation);
                this.reportAutomation(nativeId, automation.providedName);
            }
        }

        (async () => {
            const updatePluginsNativeId = 'automation:update-plugins'
            let updatePlugins = this.automations.get(updatePluginsNativeId);
            if (!updatePlugins) {
                await this.reportAutomation(updatePluginsNativeId, 'Autoupdate Plugins');
                updatePlugins = new Automation(updatePluginsNativeId);
                updatePlugins.storage.setItem('data', JSON.stringify(updatePluginsData));
                updatePlugins.data = updatePlugins.storageSettings.values.data;
                updatePlugins.bind();
                this.automations.set(updatePluginsNativeId, updatePlugins);
            }
        })();
    }

    async getReadmeMarkdown(): Promise<string> {
        return "Create custom smart home actions that trigger on specific events.";
    }

    async getCreateDeviceSettings(): Promise<Setting[]> {
        return [
            {
                key: 'name',
                title: 'Name',
                description: 'The name or description of the new automation.',
            },
        ]
    }

    async createDevice(settings: DeviceCreatorSettings): Promise<string> {
        const { name } = settings;
        const nativeId = 'automation:' + randomBytes(8).toString('hex');
        await this.reportAutomation(nativeId, name?.toString());
        const automation = new Automation(nativeId);
        this.automations.set(nativeId, automation);
        return nativeId;
    }

    async reportAutomation(nativeId: string, name?: string) {
        const device: Device = {
            providerNativeId: AutomationCoreNativeId,
            name,
            nativeId,
            type: ScryptedDeviceType.Automation,
            interfaces: [ScryptedInterface.OnOff, ScryptedInterface.Settings]
        }
        await deviceManager.onDeviceDiscovered(device);
    }


    async getDevice(nativeId: string) {
        return this.automations.get(nativeId);
    }
 
    async releaseDevice(id: string, nativeId: string): Promise<void> {
    }
}
