import axios from 'axios';
import semver from 'semver';

import { getComponentWebPath } from "../helpers";
const componentPath = getComponentWebPath('script');

export interface PluginUpdateCheck {
    updateAvailable?: string;
    versions: any;
}

export async function checkUpdate(npmPackage: string, npmPackageVersion: string): Promise<PluginUpdateCheck> {
    const response = await axios.get(`${componentPath}/npm/${npmPackage}`);
    const { data } = response;
    const versions = Object.values(data.versions).sort((a: any, b: any) => semver.compare(a.version, b.version)).reverse();
    if (data["dist-tags"]) {
        let latest = data["dist-tags"].latest;
        if (npmPackageVersion && semver.gt(latest, npmPackageVersion)) {
            return {
                updateAvailable: latest,
                versions,
            };
        }
    }
    return {
        updateAvailable: undefined,
        versions,
    };
}

export async function installNpm(npmPackage: string, version?: string): Promise<string> {
    let suffix = version ? `/${version}` : '';
    return axios.post(
        `${componentPath}/install/${npmPackage}${suffix}`
    ).then(response => response.data.id);
}

export function getNpmPath(npmPackage) {
    return `https://www.npmjs.com/package/${npmPackage}`;
}