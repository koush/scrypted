import sdk, { ScryptedDeviceType, ScryptedInterface, Setting, Settings, SettingValue } from ".";

const { systemManager } = sdk;

function parseValue(value: string | null | undefined, setting: StorageSetting, readDefaultValue: () => any, rawDevice?: boolean) {
    if (value === null || value === undefined) {
        return readDefaultValue();
    }

    const type = setting.multiple ? 'array' : setting.type;

    if (type === 'boolean') {
        if (value === 'true')
            return true;
        if (value === 'false')
            return false;
        return readDefaultValue() || false;
    }
    if (type === 'number') {
        const n = parseFloat(value);
        if (!isNaN(n))
            return n;
        return readDefaultValue() || 0;
    }
    if (type === 'integer') {
        const n = parseInt(value);
        if (!isNaN(n))
            return n;
        return readDefaultValue() || 0;
    }
    if (type === 'array') {
        if (!value)
            return readDefaultValue() || [];
        try {
            return JSON.parse(value);
        }
        catch (e) {
            return readDefaultValue() || [];
        }
    }
    if (type === 'device') {
        if (rawDevice)
            return value;
        return systemManager.getDeviceById(value) || systemManager.getDeviceById(readDefaultValue());
    }

    // string type, so check if it is json.
    if (value && setting.json) {
        try {
            return JSON.parse(value)
        }
        catch (e) {
            return readDefaultValue();
        }
    }

    return value || readDefaultValue();
}

export interface StorageSetting extends Omit<Setting, 'deviceFilter'> {
    deviceFilter?: string | ((test: { id: string, deviceInterface: string, interfaces: string[], type: ScryptedDeviceType, ScryptedDeviceType: typeof ScryptedDeviceType, ScryptedInterface: typeof ScryptedInterface }) => boolean);

    defaultValue?: any;
    persistedDefaultValue?: any;
    onPut?: (oldValue: any, newValue: any) => void;
    onGet?: () => Promise<StorageSetting>;
    mapPut?: (oldValue: any, newValue: any) => any;
    mapGet?: (value: any) => any;
    json?: boolean;
    hide?: boolean;
    noStore?: boolean;
}

export type StorageSettingsDict<T extends string> = { [key in T]: StorageSetting };

export interface StorageSettingsDevice {
    storage: Storage;
    onDeviceEvent(eventInterface: string, eventData: any): Promise<void>;
}

export class StorageSettings<T extends string> implements Settings {
    public values: { [key in T]: any } = {} as any;
    public hasValue: { [key in T]: boolean } = {} as any;
    public options?: {
        hide?: {
            [key in T]?: () => Promise<boolean>;
        },
        onGet?: () => Promise<Partial<StorageSettingsDict<T>>>,
    };

    constructor(public device: StorageSettingsDevice, public settings: StorageSettingsDict<T>) {
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
                enumerable: true,
            });
            Object.defineProperty(this.hasValue, key, {
                get: () => this.device.storage.getItem(key) != null,
                enumerable: true,
            });
        }
    }

    get keys(): { [key in T]: string } {
        const ret: any = {};
        for (const key of Object.keys(this.settings)) {
            ret[key] = key;
        }
        return ret;
    }

    async getSettings(): Promise<Setting[]> {
        const onGet = await this.options?.onGet?.();

        const ret = [];
        for (const [key, setting] of Object.entries(this.settings)) {
            let s: StorageSetting = Object.assign({}, setting);
            if (onGet?.[key as T])
                s = Object.assign(s, onGet[key as T]);
            if (s.onGet)
                s = Object.assign(s, await s.onGet());
            if (s.hide || await this.options?.hide?.[key as T]?.())
                continue;
            s.key = key;
            s.value = this.getItemInternal(key as T, s, true);
            if (typeof s.deviceFilter === 'function')
                s.deviceFilter = s.deviceFilter.toString();
            ret.push(s as Setting);
            delete s.onPut;
            delete s.onGet;
            delete s.mapPut;
            delete s.mapGet;
        }
        return ret;
    }

    async putSetting(key: string, value: SettingValue): Promise<void> {
        const setting: StorageSetting = this.settings[key as T];
        let oldValue: any;
        if (setting)
            oldValue = this.getItemInternal(key as T, setting);
        return this.putSettingInternal(setting, oldValue, key, value);
    }

    putSettingInternal(setting: StorageSetting, oldValue: any, key: string, value: SettingValue) {
        if (!setting?.noStore) {
            if (setting?.mapPut)
                value = setting.mapPut(oldValue, value);
            // nullish values should be removed, since Storage can't persist them correctly.
            if (value == null)
                this.device.storage.removeItem(key);
            else if (typeof value === 'object')
                this.device.storage.setItem(key, JSON.stringify(value));
            else
                this.device.storage.setItem(key, value?.toString());
        }
        setting?.onPut?.(oldValue, value);
        if (!setting?.hide)
            this.device.onDeviceEvent(ScryptedInterface.Settings, undefined);
    }

    getItemInternal(key: T, setting: StorageSetting, rawDevice?: boolean): any {
        if (!setting)
            return this.device.storage.getItem(key);
        const readDefaultValue = () => {
            if (setting.persistedDefaultValue != null) {
                this.putSettingInternal(setting, undefined, key, setting.persistedDefaultValue);
                return setting.persistedDefaultValue;
            }
            return setting.defaultValue;
        };
        const ret = parseValue(this.device.storage.getItem(key), setting, readDefaultValue, rawDevice);
        return setting.mapGet ? setting.mapGet(ret) : ret;
    }

    getItem(key: T): any {
        return this.getItemInternal(key, this.settings[key]);
    }
}
