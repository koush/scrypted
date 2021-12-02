import { ensurePluginVolume } from "./plugin-volume";
import fs from 'fs';
import child_process from 'child_process';
import path from 'path';
import { once } from 'events';

export async function installOptionalDependencies(console: Console, packageJson: any) {
    const pluginVolume = ensurePluginVolume(packageJson.name);
    const optPj = path.join(pluginVolume, 'package.json');

    let currentPackageJson: any;
    try {
        currentPackageJson = JSON.parse(fs.readFileSync(optPj).toString());
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

    try {
        fs.writeFileSync(optPj, JSON.stringify(reduced));

        const cp = child_process.spawn('npm', ['--prefix', pluginVolume, 'install'], {
            cwd: pluginVolume,
            stdio: 'inherit',
        });
    
        await once(cp, 'exit');
        if (cp.exitCode !== 0)
            throw new Error('npm installation failed with exit code ' + cp.exitCode);
    }
    catch (e) {
        fs.rmSync(optPj);
        throw e;
    }
    console.log('native dependencies installed.');
}
