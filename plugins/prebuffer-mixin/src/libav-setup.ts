import * as libav from '@scrypted/libav';
import path from 'path';

function getAddonInstallPath() {
    if (process.versions.electron)
        process.env.npm_config_runtime = 'electron';
    const binaryUrl = libav.getBinaryUrl();
    const u = new URL(binaryUrl);
    const withoutExtension = path.basename(u.pathname).replace(/\.tar.gz$/, '');
    return path.join(process.env.SCRYPTED_PLUGIN_VOLUME, libav.version, withoutExtension);
}

export async function installLibavAddon(installOnly = false) {
    const nr = installOnly
        ? null
        // @ts-expect-error
        : __non_webpack_require__;
    await libav.install(getAddonInstallPath(), nr);
}
