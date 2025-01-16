import child_process from 'child_process';
import { once } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import process from 'process';
import { ensurePluginVolume } from "./plugin-volume";

export function defaultNpmExec(args: string[], options: child_process.SpawnOptions) {
    let npm = 'npm';
    if (os.platform() === 'win32') {
        npm += '.cmd';
        // wrap each argument in a quote to handle spaces in paths
        // https://github.com/nodejs/node/issues/38490#issuecomment-927330248
        args = args.map(arg => '"' + arg + '"');
    }
    const cp = child_process.spawn(npm, args, options);
    return cp;
}

let npmExecFunction = defaultNpmExec;
export function setNpmExecFunction(f: typeof npmExecFunction) {
    npmExecFunction = f;
}

export function getPluginNodePath(name: string) {
    const pluginVolume = ensurePluginVolume(name);

    const abi = process.versions.modules;
    let runtime = process.env.npm_config_runtime;
    if (!runtime && process.versions.electron)
        runtime = 'electron';
    if (!runtime)
        runtime = 'node';
    const { platform, arch } = process;
    let nodeVersionedDirectory = `n-${runtime}-v${abi}-${platform}-${arch}`;

    const scryptedBase = process.env.SCRYPTED_BASE_VERSION;
    if (scryptedBase)
        nodeVersionedDirectory += '-' + scryptedBase;
    const nodePrefix = path.join(pluginVolume, nodeVersionedDirectory);
    return nodePrefix;
}

export async function installOptionalDependencies(console: Console, packageJson: any) {
    const nodePrefix = getPluginNodePath(packageJson.name);
    const packageJsonPath = path.join(nodePrefix, 'package.json');
    const currentInstalledPackageJsonPath = path.join(nodePrefix, 'package.installed.json');

    let currentPackageJson: any;
    try {
        currentPackageJson = JSON.parse(fs.readFileSync(currentInstalledPackageJsonPath).toString());
    }
    catch (e) {
    }

    try {
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
        delete reduced.scripts;

        await fs.promises.mkdir(nodePrefix, {
            recursive: true,
        })
        fs.writeFileSync(packageJsonPath, JSON.stringify(reduced));

        const cp = npmExecFunction(['--prefix', nodePrefix, 'install'], {
            cwd: nodePrefix,
            stdio: 'inherit',
            // allow spawning .cmd https://nodejs.org/en/blog/vulnerability/april-2024-security-releases-2
            shell: os.platform() === 'win32' ? true : undefined,
        });

        await once(cp, 'exit');
        if (cp.exitCode !== 0)
            throw new Error('npm installation failed with exit code ' + cp.exitCode);

        fs.writeFileSync(currentInstalledPackageJsonPath, JSON.stringify(reduced));
        console.log('native dependencies installed.');
    }
    finally {
        const pluginVolume = ensurePluginVolume(packageJson.name);
        for (const de of await fs.promises.readdir(pluginVolume, {
            withFileTypes: true,
        })) {
            const filePath = path.join(pluginVolume, de.name);
            if (filePath === nodePrefix)
                continue;
            if (!de.isDirectory())
                return;
            if (de.name.startsWith('linux') || de.name.startsWith('darwin') || de.name.startsWith('win32')
                || de.name.startsWith('python') || de.name.startsWith('node') || de.name.startsWith('n-')) {
                console.log('Removing old dependencies:', filePath);
                try {
                    await fs.promises.rm(filePath, {
                        recursive: true,
                        force: true,
                    });
                }
                catch (e) {
                }
            }
        }
    }
}
