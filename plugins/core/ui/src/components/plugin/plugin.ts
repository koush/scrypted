import { ScryptedStatic } from '@scrypted/types';
import { DeviceManager } from '@scrypted/types';
import { DeviceCreator } from '@scrypted/types';
import { ScryptedInterface } from '@scrypted/types';
import { Scriptable } from '@scrypted/types';
import { SystemManager } from '@scrypted/types';
import axios, { AxiosResponse } from 'axios';
import semver from 'semver';
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
    // const response = await axios.get(`${componentPath}/npm/${npmPackage}`);
    // registry.npmjs.org does not support CORS on the package endpoints.
    // open issue:
    // https://github.com/npm/feedback/discussions/117
    // npmjs.cf is an unofficial CDN that provides it
    try {
        response = await axios.get(`https://registry.npmjs.cf/${npmPackage}`);
    }
    catch (e) {
        // sometimes registry.npmjs.cf busts up their CORS headers or goes down... fall back.
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

export function installNpm(systemManager: SystemManager, npmPackage: string, version?: string, installedSet?: Set<string>): Promise<string> {
    if (!installedSet)
        installedSet = new Set();
    if (installedSet.has(npmPackage))
        return;
    installedSet.add(npmPackage);
    let suffix = version ? `/${version}` : '';
    const scryptedId = axios.post(
        `${componentPath}/install/${npmPackage}${suffix}`
    ).then(response => response.data.id);

    scryptedId.then(async (id) => {
        const plugins = await systemManager.getComponent('plugins');
        const packageJson = await plugins.getPackageJson(npmPackage);
        for (const dep of packageJson.scrypted.pluginDependencies || []) {
            try {
                const depId = await plugins.getIdForPluginId(dep);
                if (depId)
                    throw new Error('Plugin already installed.');
                installNpm(systemManager, dep, undefined, installedSet);
            }
            catch (e) {
                console.log('Skipping', dep, ':', e.message);
            }
        }
    });

    return scryptedId;
}

export function getNpmPath(npmPackage: string) {
    return `https://www.npmjs.com/package/${npmPackage}`;
}

export async function snapshotCurrentPlugins(scrypted: ScryptedStatic): Promise<string> {
    const { systemManager, deviceManager } = scrypted;

    const plugins = await systemManager.getComponent("plugins");
    const id = await plugins.getIdForNativeId('@scrypted/core', 'scriptcore');
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