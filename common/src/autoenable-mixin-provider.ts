import { ScryptedDevice, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface } from "@scrypted/sdk";
import sdk from "@scrypted/sdk";

const { systemManager } = sdk;


export abstract class AutoenableMixinProvider extends ScryptedDeviceBase {
    hasEnabledMixin: { [id: string]: string } = {};
    pluginsComponent: Promise<any>;

    constructor(nativeId?: string, public autoIncludeToken = 'v4') {
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

        process.nextTick(() => {
            for (const id of Object.keys(systemManager.getSystemState())) {
                const device = systemManager.getDeviceById(id);
                this.maybeEnableMixin(device);
            }
        });
    }

    async shouldEnableMixin(device: ScryptedDevice) {
        return true;
    }

    checkHasEnabledMixin(device: ScryptedDevice) {
        return this.hasEnabledMixin[device.id] === this.autoIncludeToken;
    }

    shouldUnshiftMixin(device: ScryptedDevice) {
        return false;
    }

    async maybeEnableMixin(device: ScryptedDevice) {
        if (!device || device.mixins?.includes(this.id))
            return;

        if (this.checkHasEnabledMixin(device))
            return;

        const match = await this.canMixin(device.type, device.interfaces);
        if (!match)
            return;

        if (!await this.shouldEnableMixin(device))
            return;

        this.log.i('auto enabling mixin for ' + device.name)
        const mixins = (device.mixins || []).slice();
        if (this.shouldUnshiftMixin(device))
            mixins.unshift(this.id);
        else
            mixins.push(this.id);
        const plugins = await this.pluginsComponent;
        await plugins.setMixins(device.id, mixins);
        this.setHasEnabledMixin(device.id);
    }

    setHasEnabledMixin(id: string) {
        if (this.hasEnabledMixin[id] === this.autoIncludeToken)
            return;
        this.hasEnabledMixin[id] = this.autoIncludeToken;
        this.storage.setItem('hasEnabledMixin', JSON.stringify(this.hasEnabledMixin));
    }

    abstract canMixin(type: ScryptedDeviceType | string, interfaces: string[]): Promise<string[] | null | undefined | void>;
}
