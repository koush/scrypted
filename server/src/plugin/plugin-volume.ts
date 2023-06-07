import fs from 'fs';
import os from 'os';
import path from 'path';

export function getScryptedVolume() {
    const volumeDir = process.env.SCRYPTED_VOLUME || path.join(os.homedir(), '.scrypted', 'volume');
    return volumeDir;
}

export function getPluginVolume(pluginId: string) {
    const volume = getScryptedVolume();
    const pluginVolume = path.join(volume, 'plugins', pluginId);
    return pluginVolume;
}

export function ensurePluginVolume(pluginId: string) {
    const pluginVolume = getPluginVolume(pluginId);
    try {
        fs.mkdirSync(pluginVolume, {
            recursive: true,
        })
    }
    catch (e) {
    }
    return pluginVolume;
}
