import { HAPStorage } from './hap';
import './types'


class HAPLocalStorage {
    initSync() {

    }
    getItem(key: string): any {
        const data = localStorage.getItem(key);
        if (!data)
            return;
        return JSON.parse(data);
    }
    setItemSync(key: string, value: any) {
        localStorage.setItem(key, JSON.stringify(value));
    }
    removeItemSync(key: string) {
        localStorage.removeItem(key);
    }

    persistSync() {

    }
}

// HAP storage seems to be global?
export function initializeHapStorage() {
    HAPStorage.setStorage(new HAPLocalStorage());
}


export function createHAPUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

export function getHAPUUID(storage: Storage) {
    let uuid = storage.getItem('uuid');
    if (!uuid) {
        uuid = createHAPUUID();
        storage.setItem('uuid', uuid);
    }
    return uuid;   
}
