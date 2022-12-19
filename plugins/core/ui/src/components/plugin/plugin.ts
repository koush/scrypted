import { ScryptedStatic } from '@scrypted/types';
import { DeviceManager } from '@scrypted/types';
import { DeviceCreator } from '@scrypted/types';
import { ScryptedInterface } from '@scrypted/types';
import { Scriptable } from '@scrypted/types';
import { SystemManager } from '@scrypted/types';
import axios, { AxiosResponse } from 'axios';
import semver from 'semver';
import { getAllDevices } from '../../common/mixin';
const pluginSnapshot = require("!!raw-loader!./plugin-snapshot.ts").default.split('\n')
    .filter(line => !line.includes('SCRYPTED_FILTER_EXAMPLE_LINE'))
    .join('\n')
    .trim();

import { getComponentWebPath } from "../helpers";
const componentPath = getComponentWebPath('script');

export interface PluginUpdateCheck {
    updateAvailable?: string;
    versions: any;
}

export async function checkUpdate(npmPackage: string, npmPackageVersion: string): Promise<PluginUpdateCheck> {
    let response: AxiosResponse<any>;
    try {
        response = await axios.get(`https://registry.npmjs.org/${npmPackage}`);
    }
    catch (e) {
        // 4/13/2022 registry.npmjs.org added CORS headers, so using the CORS compatible mirror
        // registry.npmjs.cf is no longer necessary. But just in case,
        // if registry.npmjs.org busts up their CORS headers... have this fallback method.
        response = await axios.get(`${componentPath}/npm/${npmPackage}`);
    }
    const { data } = response;
    const versions = Object.values(data.versions).sort((a: any, b: any) => semver.compare(a.version, b.version)).reverse();
    let updateAvailable: any;
    let latest: any;
    if (data["dist-tags"]) {
        latest = data["dist-tags"].latest;
        if (npmPackageVersion && semver.gt(latest, npmPackageVersion)) {
            updateAvailable = latest;
        }
    }
    for (const [k, v] of Object.entries(data['dist-tags'])) {
        const found: any = versions.find((version: any) => version.version === v);
        if (found) {
            found.tag = k;
        }
    }
    const current: any = versions.find((version: any) => version.version === npmPackageVersion);
    if (current) {
        current.tag = 'installed';
    }
    // make sure latest build is first instead of a beta.
    if (latest) {
        const index = versions.findIndex((v: any) => v.version === latest);
        const [spliced] = versions.splice(index, 1);
        versions.unshift(spliced);
    }
    return {
        updateAvailable,
        versions,
    };
}

export async function installNpm(systemManager: SystemManager, npmPackage: string, version?: string): Promise<string> {
    let suffix = version ? `/${version}` : '';
    const response = await axios.post(
        `${componentPath}/install/${npmPackage}${suffix}`
    );
    return response.data.id;
}

export function getNpmPath(npmPackage: string) {
    return `https://www.npmjs.com/package/${npmPackage}`;
}

export function getIdForNativeId(systemManager: SystemManager, pluginId: string, nativeId: string) {
    const found = getAllDevices(systemManager).find(device => device.pluginId === pluginId && device, nativeId === nativeId);
    return found?.id;
}

export async function snapshotCurrentPlugins(scrypted: ScryptedStatic): Promise<string> {
    const { systemManager, deviceManager } = scrypted;

    const id = getIdForNativeId(systemManager, '@scrypted/core', 'scriptcore');
    const scriptCore = systemManager.getDeviceById<DeviceCreator & Scriptable>(id);
    const backupId = await scriptCore.createDevice({
    });
    // need to set the name so it doesn't get clobbered by ScriptCore reporting a
    // blank providedName later.
    const name = 'Plugins Snapshot: ' + new Date().toDateString();
    const backup = systemManager.getDeviceById<Scriptable>(backupId);
    await backup.setName(name);

    const installedPlugins: { [pluginId: string]: string } = {};

    Object.keys(systemManager.getSystemState())
        .map(id => systemManager.getDeviceById(id))
        .filter(device => device.interfaces.includes(ScryptedInterface.ScryptedPlugin))
        .forEach(plugin => installedPlugins[plugin.info.manufacturer] = plugin.info.version);

    const script = `const snapshot = ${JSON.stringify(installedPlugins, undefined, 2)};\n${pluginSnapshot}`;
    console.log(script);
    await backup.saveScript({
        script: `// Running the script will restore your plugins to the versions
// contained in this snapshot. Your settings will remain.
// You can view the progress and errors in the console.
const snapshot = ${JSON.stringify(installedPlugins, undefined, 2)};\n${pluginSnapshot}`,
    });
    return backupId;
}