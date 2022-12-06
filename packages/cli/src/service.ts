
import child_process from 'child_process';
import { once } from 'events';
import fs from 'fs';
import rimraf from 'rimraf';
import path from 'path';
import os from 'os';
import mkdirp from 'mkdirp';
import semver from 'semver';

async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const EXIT_FILE = '.exit';
const UPDATE_FILE = '.update';

async function runCommand(command: string, ...args: string[]) {
    if (os.platform() === 'win32')
        command += '.cmd';
    console.log('running', command, ...args);
    const cp = child_process.spawn(command, args, {
        stdio: 'inherit'
    });
    await once(cp, 'exit');
    if (cp.exitCode)
        throw new Error(`${command} exited with non zero result ${cp.exitCode}`);
}

async function runCommandEatError(command: string, ...args: string[]) {
    try {
        await runCommand(command, ...args);
    }
    catch (e) {
        console.warn(command, args, 'command exited with error, ignoring', e)
    }
}

export async function runServer(installDir: string) {
    console.log('Starting scrypted main...');
    await runCommand('npm', '--prefix', installDir, 'exec', 'scrypted-serve');
}

async function startServer(installDir: string) {
    try {
        await runServer(installDir);
    }
    catch (e) {
        console.error('scrypted server exited with error', e);
    }
}

export function getInstallDir() {
    return process.env.SCRYPTED_INSTALL_PATH || path.join(os.homedir(), '.scrypted');
}

export function cwdInstallDir(): { volume: string, installDir: string } {
    const installDir = getInstallDir();
    const volume = path.join(installDir, 'volume');
    mkdirp.sync(volume);
    process.chdir(installDir);
    return { volume, installDir };
}

export async function installServe(installVersion: string, ignoreError?: boolean) {
    const { installDir } = cwdInstallDir();
    const packageLockJson = path.join(installDir, 'package-lock.json');
    // apparently corrupted or old version of package-lock.json prevents upgrades, so
    // nuke it before installing.
    rimraf.sync(packageLockJson);

    const installJson = path.join(installDir, 'install.json');
    try {
        const { version } = JSON.parse(fs.readFileSync(installJson).toString());
        if (semver.parse(process.version).major !== semver.parse(version).major)
            throw new Error('mismatch');
    }
    catch (e) {
        const nodeModules = path.join(installDir, 'node_modules');
        console.log('Node version mismatch, missing, or corrupt. Clearing node_modules.');
        rimraf.sync(nodeModules);
    }
    fs.writeFileSync(installJson, JSON.stringify({
        version: process.version,
    }));

    const args = ['--prefix', installDir, 'install', '--production', `@scrypted/server@${installVersion}`]
    if (ignoreError)
        await runCommandEatError('npm', ...args);
    else
        await runCommand('npm', ...args);
    return installDir;
}

export async function serveMain(installVersion?: string) {
    let install = !!installVersion;

    const { installDir, volume } = cwdInstallDir();
    if (!fs.existsSync('node_modules/@scrypted/server')) {
        install = true;
        installVersion ||= 'latest';
        console.log('Package @scrypted/server not found. Installing.');
    }
    if (install) {
        await installServe(installVersion, true);
    }

    process.env.SCRYPTED_NPM_SERVE = 'true';
    process.env.SCRYPTED_VOLUME = volume;
    process.env.SCRYPTED_CAN_EXIT = 'true';
    process.env.SCRYPTED_CAN_RESTART = 'true';
    console.log('cwd', process.cwd());

    while (true) {
        rimraf.sync(EXIT_FILE);
        rimraf.sync(UPDATE_FILE);

        await startServer(installDir);

        if (fs.existsSync(EXIT_FILE)) {
            console.log('Exiting.');
            process.exit();
        }
        else if (fs.existsSync(UPDATE_FILE)) {
            console.log('Update requested. Installing.');
            await runCommandEatError('npm', '--prefix', installDir, 'install', '--production', '@scrypted/server@latest');
        }
        else {
            console.log(`Service exited. Restarting momentarily.`);
            await sleep(10000);
        }
    }
}
