import { ensurePluginVolume } from "./plugin-volume";
import fs from 'fs';
import child_process from 'child_process';
import path from 'path';
import { once } from 'events';
import process from 'process';
import rimraf from "rimraf";
import mkdirp from "mkdirp";

export async function installOptionalDependencies(console: Console, packageJson: any) {
    const pluginVolume = ensurePluginVolume(packageJson.name);
    const nodePrefix = path.join(pluginVolume, `${process.platform}-${process.arch}`);
    const packageJsonPath = path.join(nodePrefix, 'package.json');
    const currentInstalledPackageJsonPath = path.join(nodePrefix, 'package.installed.json');

    let currentPackageJson: any;
    try {
        currentPackageJson = JSON.parse(fs.readFileSync(currentInstalledPackageJsonPath).toString());
    }
    catch (e) {
    }

    const { optionalDependencies } = packageJson;
    if (!optionalDependencies)
        return;
    if (!Object.keys(optionalDependencies).length)
        return;
    const currentOptionalDependencies = currentPackageJson?.dependencies || {};

    if (JSON.stringify(optionalDependencies) === JSON.stringify(currentOptionalDependencies)) {
        console.log('native dependencies (up to date).', ...Object.keys(optionalDependencies));
        return;
    }

    console.log('native dependencies (outdated)', ...Object.keys(optionalDependencies));

    const reduced = Object.assign({}, packageJson);
    reduced.dependencies = reduced.optionalDependencies;
    delete reduced.optionalDependencies;
    delete reduced.devDependencies;

    mkdirp.sync(nodePrefix);
    fs.writeFileSync(packageJsonPath, JSON.stringify(reduced));

    const cp = child_process.spawn('npm', ['--prefix', nodePrefix, 'install'], {
        cwd: nodePrefix,
        stdio: 'inherit',
    });

    await once(cp, 'exit');
    if (cp.exitCode !== 0)
        throw new Error('npm installation failed with exit code ' + cp.exitCode);

    fs.writeFileSync(currentInstalledPackageJsonPath, JSON.stringify(reduced));
    console.log('native dependencies installed.');
}
