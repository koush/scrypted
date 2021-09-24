import { MixinProvider, ScryptedDevice, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface } from "@scrypted/sdk";
import sdk from "@scrypted/sdk";

const { systemManager } = sdk;

export abstract class AutoenableMixinProvider extends ScryptedDeviceBase {
    hasEnabledMixin: { [id: string]: boolean } = {};
    pluginsComponent: Promise<any>;

    constructor(nativeId?: string) {
        super(nativeId);

        try {
            this.hasEnabledMixin = JSON.parse(this.storage.getItem('hasEnabledMixin'));
        }
        catch (e) {
            this.hasEnabledMixin = {};
        }

        this.pluginsComponent = systemManager.getComponent('plugins');

        // watch for descriptor changes.
        systemManager.listen(async (eventSource, eventDetails, eventData) => {
            if (eventDetails.eventInterface !== ScryptedInterface.ScryptedDevice || eventDetails.property)
                return;

            this.maybeEnableMixin(eventSource);
        });

        for (const id of Object.keys(systemManager.getSystemState())) {
            const device = systemManager.getDeviceById(id);
            this.maybeEnableMixin(device);
        }
    }

    async maybeEnableMixin(device: ScryptedDevice) {
        if (!device || device.mixins?.includes(this.id))
            return;

        if (this.hasEnabledMixin[device.id])
            return;

        const match = await this.canMixin(device.type, device.interfaces);
        if (!match)
            return;

        this.log.i('auto enabling mixin for ' + device.name)
        const mixins = device.mixins || [];
        mixins.push(this.id);
        const plugins = await this.pluginsComponent;
        await plugins.setMixins(device.id, mixins);
    }

    setHasEnabledMixin(id: string) {
        if (this.hasEnabledMixin[id])
            return;
        this.hasEnabledMixin[id] = true;
        this.storage.setItem('hasEnabledMixin', JSON.stringify(this.hasEnabledMixin));
    }

    abstract canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]>;
}
