import path from 'path';
import mkdirp from 'mkdirp';

export function getPluginVolume(pluginId: string) {
    const volume = path.join(process.cwd(), 'volume');
    const pluginVolume = path.join(volume, 'plugins', pluginId);
    return pluginVolume;
}

export function ensurePluginVolume(pluginId: string) {
    const pluginVolume = getPluginVolume(pluginId);
    try {
        mkdirp.sync(pluginVolume);
    }
    catch (e) {
    }
    return pluginVolume;
}
