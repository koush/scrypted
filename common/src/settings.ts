import sdk, { MixinDeviceBase, ScryptedDeviceBase, ScryptedInterface, Setting, Settings, SettingValue } from "@scrypted/sdk";

const { systemManager } = sdk;

function parseValue(value: string, setting: StorageSetting) {
    const { defaultValue } = setting;
    const type = setting.multiple ? 'array' : setting.type;

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

    // string type, so check if it is json.
    if (value && setting.json) {
        try {
            return JSON.parse(value)
        }
        catch (e) {
            return defaultValue;
        }
    }

    return value || defaultValue;
}

export type HideFunction = (device: any) => boolean;

export interface StorageSetting extends Setting {
    defaultValue?: any;
    onPut?: (oldValue: any, newValue: any) => void;
    onGet?: () => Promise<StorageSetting>;
    mapPut?: (oldValue: any, newValue: any) => any;
    json?: boolean;
    hide?: boolean;
    noStore?: boolean;
}

export class StorageSettings<T extends string> implements Settings {
    public values: { [key in T]: any } = {} as any;
    public options?: {
        hide?: {
            [key in T]?: () => Promise<boolean>;
        }
    };

    constructor(public device: ScryptedDeviceBase | MixinDeviceBase<any>, public settings: { [key in T]: StorageSetting }) {
        for (const key of Object.keys(settings)) {
            const setting = settings[key as T];
            const rawGet = () => this.getItem(key as T);
            let get: () => any;
            if (setting.type !== 'clippath') {
                get = rawGet;
            }
            else {
                // maybe need a mapPut. clippath is the only complex type at the moment.
                get = () => {
                    try {
                        return JSON.parse(rawGet());
                    }
                    catch (e) {
                    }
                };
            }
            Object.defineProperty(this.values, key, {
                get,
                set: value => this.putSetting(key, value),
            });
        }
    }

    async getSettings(): Promise<Setting[]> {
        const ret = [];
        for (const [key, setting] of Object.entries(this.settings)) {
            let s: StorageSetting = Object.assign({}, setting);
            if (s.onGet)
                s = Object.assign(s, await s.onGet());
            if (s.hide || await this.options?.hide?.[key as T]?.())
                continue;
            s.key = key;
            s.value = this.getItem(key as T);
            ret.push(s);
            delete s.onPut;
            delete s.onGet;
            delete s.mapPut;
        }
        return ret;
    }

    async putSetting(key: string, value: SettingValue): Promise<void> {
        const setting: StorageSetting = this.settings[key as T];
        let oldValue: any;
        if (setting)
            oldValue = this.getItem(key as T);
        if (!setting?.noStore) {
            if (setting.mapPut)
                value = setting.mapPut(oldValue, value);
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
        return parseValue(this.device.storage.getItem(key), setting);
    }
}
