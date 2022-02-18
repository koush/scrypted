import sdk, { MixinDeviceBase, ScryptedDeviceBase, ScryptedInterface, Setting, Settings, SettingValue } from "@scrypted/sdk";

const { systemManager } = sdk;

function parseValue(value: string, type: SettingValue, defaultValue: any) {
    if (type === 'boolean') {
        if (value === 'true')
            return true;
        if (value === 'false')
            return false;
        return defaultValue || false;
    }
    if (type === 'number') {
        return parseFloat(value) || defaultValue || 0;
    }
    if (type === 'integer') {
        return parseInt(value) || defaultValue || 0;
    }
    if (type === 'array') {
        try {
            return JSON.parse(value);
        }
        catch (e) {
            return [];
        }
    }
    if (type === 'device') {
        return systemManager.getDeviceById(value);
    }

    return value || defaultValue;
}

export interface StorageSetting extends Setting {
    defaultValue?: any;
    onPut?: (oldValue: any, newValue: any) => void;
    hide?: boolean;
    noStore?: boolean;
}

export class StorageSettings<T extends string> implements Settings {
    public values: { [key in T]: any } = {} as any;

    constructor(public device: ScryptedDeviceBase | MixinDeviceBase<any>, public settings: { [key in T]: StorageSetting }) {
        for (const key of Object.keys(settings)) {
            Object.defineProperty(this.values, key, {
                get: () => this.getItem(key as T),
                set: value => this.putSetting(key, value),
            });
        }
    }

    async getSettings(): Promise<Setting[]> {
        const ret = [];
        for (const [key, setting] of Object.entries(this.settings)) {
            const s: StorageSetting = Object.assign({}, setting);
            if (s.hide)
                continue;
            s.key = key;
            s.value = this.getItem(key as T);
            ret.push(s);
            delete s.onPut;
        }
        return ret;
    }

    async putSetting(key: string, value: SettingValue): Promise<void> {
        const setting: StorageSetting = this.settings[key];
        let oldValue: any;
        if (setting)
            oldValue = this.getItem(key as T);
        if (!setting?.noStore) {
            if (typeof value === 'object')
                this.device.storage.setItem(key, JSON.stringify(value));
            else
                this.device.storage.setItem(key, value?.toString());
        }
        setting?.onPut?.(oldValue, value);
        this.device.onDeviceEvent(ScryptedInterface.Settings, undefined);
    }

    getItem(key: T): any {
        const setting = this.settings[key];
        if (!setting)
            return this.device.storage.getItem(key);
        const type = setting.multiple ? 'array' : setting.type;
        return parseValue(this.device.storage.getItem(key), type, setting.defaultValue);
    }
}
