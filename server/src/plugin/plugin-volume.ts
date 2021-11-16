import path from 'path';
import mkdirp from 'mkdirp';

export function ensurePluginVolume(pluginId: string) {
    const volume = path.join(process.cwd(), 'volume');
    const pluginVolume = path.join(volume, 'plugins', pluginId);
    try {
        mkdirp.sync(pluginVolume);
    }
    catch (e) {
    }
    return pluginVolume;
}
