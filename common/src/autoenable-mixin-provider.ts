import { ScryptedDevice, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface } from "@scrypted/sdk";
import sdk from "@scrypted/sdk";

const { systemManager } = sdk;

const autoIncludeToken = 'v4';

export abstract class AutoenableMixinProvider extends ScryptedDeviceBase {
    hasEnabledMixin: { [id: string]: string } = {};
    pluginsComponent: Promise<any>;
    unshiftMixin = false;

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

    async shouldEnableMixin(device: ScryptedDevice) {
        return true;
    }

    async maybeEnableMixin(device: ScryptedDevice) {
        if (!device || device.mixins?.includes(this.id))
            return;

        if (this.hasEnabledMixin[device.id] === autoIncludeToken)
            return;

        const match = await this.canMixin(device.type, device.interfaces);
        if (!match)
            return;

        if (!await this.shouldEnableMixin(device))
            return;

        this.log.i('auto enabling mixin for ' + device.name)
        const mixins = (device.mixins || []).slice();
        if (this.unshiftMixin)
            mixins.unshift(this.id);
        else
            mixins.push(this.id);
        const plugins = await this.pluginsComponent;
        await plugins.setMixins(device.id, mixins);
        this.setHasEnabledMixin(device.id);
    }

    setHasEnabledMixin(id: string) {
        if (this.hasEnabledMixin[id] === autoIncludeToken)
            return;
        this.hasEnabledMixin[id] = autoIncludeToken;
        this.storage.setItem('hasEnabledMixin', JSON.stringify(this.hasEnabledMixin));
    }

    abstract canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]>;
}
