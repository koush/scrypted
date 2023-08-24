import { DeviceCreator, Scriptable, ScryptedInterface, ScryptedStatic, SystemManager } from '@scrypted/types';
import axios, { AxiosResponse } from 'axios';
import semver from 'semver';
import { getAllDevices } from '../../common/mixin';
import { sleep } from '../../common/sleep';
import { getComponentWebPath } from "../helpers";
const componentPath = getComponentWebPath('script');
const pluginSnapshot = require("!!raw-loader!./plugin-snapshot.ts").default.split('\n')
    .filter(line => !line.includes('SCRYPTED_FILTER_EXAMPLE_LINE'))
    .join('\n')
    .trim();

export interface PluginUpdateCheck {
    updateAvailable?: string;
    updatePublished?: Date;
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
    let updatePublished: any;
    let latest: any;
    if (data["dist-tags"]) {
        latest = data["dist-tags"].latest;
        if (npmPackageVersion && semver.gt(latest, npmPackageVersion)) {
            updateAvailable = latest;
            try {
                updatePublished = new Date(data["time"][latest]);
            } catch {
                updatePublished = null;
            }
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
        updatePublished,
        versions,
    };
}

export async function checkServerUpdate(version: string, installEnvironment: string): Promise<PluginUpdateCheck> {
    const { updateAvailable, updatePublished, versions } = await checkUpdate(
        "@scrypted/server",
        version
    );

    if (installEnvironment == "docker" && updatePublished) {
        console.log(`New scrypted server version published ${updatePublished}`);

        // check if there is a new docker image available, using 'latest' tag
        // this is done so newer server versions in npm are not immediately
        // displayed until a docker image has been published
        let response: AxiosResponse<any> = await axios.get("https://corsproxy.io?https://hub.docker.com/v2/namespaces/koush/repositories/scrypted/tags/latest");
        const { data } = response;
        const imagePublished = new Date(data.last_updated);
        console.log(`Latest docker image published ${imagePublished}`);

        if (imagePublished < updatePublished) {
            // docker image is not yet published
            return { updateAvailable: null, updatePublished: null, versions: null }
        }
    }
    return { updateAvailable, updatePublished, versions };
}

export async function installNpm(systemManager: SystemManager, npmPackage: string, version?: string): Promise<string> {
    const plugins = await systemManager.getComponent('plugins');
    await plugins.installNpm(npmPackage, version);
    await sleep(0);
    const plugin = systemManager.getDeviceById(npmPackage)
    return plugin.id;
}

export function getNpmPath(npmPackage: string) {
    return `https://www.npmjs.com/package/${npmPackage}`;
}

export function getIdForNativeId(systemManager: SystemManager, pluginId: string, nativeId: string) {
    const found = getAllDevices(systemManager).find(device => device.pluginId === pluginId && device.nativeId === nativeId);
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