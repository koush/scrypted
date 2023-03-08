import sdk from '@scrypted/sdk';

export function safeParseJson(value: string) {
    try {
        return JSON.parse(value);
    }
    catch (e) {
    }
}

export function getAllDevices() {
    return Object.keys(sdk.systemManager.getSystemState()).map(id => sdk.systemManager.getDeviceById(id));
}
