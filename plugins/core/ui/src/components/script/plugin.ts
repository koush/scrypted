import axios from 'axios';
import semver from 'semver';

import { getComponentWebPath } from "../helpers";
const componentPath = getComponentWebPath('script');
import qs from "query-string";


export async function checkUpdate(npmPackage, npmPackageVersion): Promise<string> {
    return axios.get(`${componentPath}/npm/${npmPackage}`).then(response => {
        const data = response.data;
        if (data["dist-tags"]) {
            let latest = data["dist-tags"].latest;
            if (npmPackageVersion && semver.gt(latest, npmPackageVersion)) {
                return latest;
            }
        }
        return null;
    });
}

export async function installNpm(npmPackage: string): Promise<string> {
    return axios.post(
        `${componentPath}/install/${npmPackage}`
    ).then(response => response.data.id);
}

export function getNpmPath(npmPackage) {
    return `https://www.npmjs.com/package/${npmPackage}`;
}