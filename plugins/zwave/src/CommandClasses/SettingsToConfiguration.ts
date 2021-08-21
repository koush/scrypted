import { Settings, Setting } from "@scrypted/sdk";
import { ZwaveDeviceBase } from "./ZwaveDeviceBase";
import { ValueID, CommandClasses } from "@zwave-js/core";

export class SettingsToConfiguration extends ZwaveDeviceBase implements Settings {
    async getSettings(): Promise<Setting[]> {
        var settings: Setting[] = [];

        const cc = this.instance.commandClasses['Configuration'];
        if (!cc) {
            throw new Error(`Configuration Command Class not found.`);
        }
        const values = this.instance.getNodeUnsafe().getDefinedValueIDs().filter(value => value.endpoint === this.instance.index && value.commandClass === CommandClasses['Configuration']);
        const node = this.instance.getNodeUnsafe();
        for (var valueId of values) {
            const metadata = node.getValueMetadata(valueId);

            let setting: Setting = {};
            setting.key = valueId.property.toString();
            setting.title = metadata.label;
            setting.description = metadata.description;
            if ((metadata as any).states)
                setting.choices = Object.values((metadata as any).states);
            const value = node.getValue(valueId) as any;
            setting.value = setting.choices?.[value] || value;
            settings.push(setting);
        }
        return settings;
    }
    async putSetting(key: string, value: any) {
        const cc = this.instance.commandClasses['Configuration'];
        const valueId = this._getValueIdOrThrow(key);
        const node = this.instance.getNodeUnsafe();
        const metadata = node.getValueMetadata(valueId);
        if ((metadata as any).states) {
            value = Object.entries((metadata as any).states).find(([, v]) => v === value)?.[0];
        }
        if (metadata.type === 'number')
            value = parseInt(value);
        cc.setValue(valueId, value);
    }

    _getValueIdOrThrow(key: string): ValueID {
        var valueId = this._getValueId(key);
        if (!valueId) {
            throw new Error(`ZwaveValueId not found: ${key}`);
        }
        return valueId;
    }

    _getValueId(key: string): ValueID {
        const cc = this.instance.commandClasses['Configuration'];
        if (!cc) {
            return null;
        }
        const values = this.instance.getNodeUnsafe().getDefinedValueIDs().filter(value => value.endpoint === this.instance.index && value.commandClass === CommandClasses['Configuration']);
        for (const valueId of values) {
            if (valueId.property.toString() === key)
                return valueId;
        }
    }
}

export default SettingsToConfiguration;
