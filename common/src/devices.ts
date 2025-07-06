import type { SystemManager } from '@scrypted/types';

export function getAllDevices<T>(systemManager: SystemManager) {
    return Object.keys(systemManager.getSystemState()).map(id => systemManager.getDeviceById<T>(id));
}
