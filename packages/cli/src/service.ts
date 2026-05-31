
import child_process from 'child_process';
import { once } from 'events';
import fs from 'fs';
import path from 'path';
import os from 'os';
import semver from 'semver';

async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const EXIT_FILE = '.exit';
const UPDATE_FILE = '.update';
const VERSION_FILE = '.version';

async function runCommand(command: string, ...args: string[]) {
    if (os.platform() === 'win32') {
        command += '.cmd';
        // wrap each argument in a quote to handle spaces in paths
        // https://github.com/nodejs/node/issues/38490#issuecomment-927330248
        args = args.map(arg => '"' + arg + '"');
    }
    console.log('running', command, ...args);
    const cp = child_process.spawn(command, args, {
        stdio: 'inherit',
        env: {
            ...process.env,
            // https://github.com/lovell/sharp/blob/eefaa998725cf345227d94b40615e090495c6d09/lib/libvips.js#L115C19-L115C46
            SHARP_IGNORE_GLOBAL_LIBVIPS: 'true',
        },
        // allow spawning .cmd https://nodejs.org/en/blog/vulnerability/april-2024-security-releases-2
        shell: os.platform() === 'win32' ? true : undefined,
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
    fs.mkdirSync(volume, {
        recursive: true,
    });
    process.chdir(installDir);
    return { volume, installDir };
}

function rimrafSync(p: string) {
    fs.rmSync(p, {
        recursive: true,
        force: true,
    });
}

export async function installServe(installVersion: string, ignoreError?: boolean) {
    const { installDir } = cwdInstallDir();
    const packageLockJson = path.join(installDir, 'package-lock.json');
    // apparently corrupted or old version of package-lock.json prevents upgrades, so
    // nuke it before installing.
    rimrafSync(packageLockJson);

    const installJson = path.join(installDir, 'install.json');
    try {
        const { version } = JSON.parse(fs.readFileSync(installJson).toString());
        const processSemver = semver.parse(process.version);
        if (!processSemver)
            throw new Error('error parsing process version');
        const installSemver = semver.parse(version);
        if (!installSemver)
            throw new Error('error parsing install.json version');
        if (processSemver.major !== installSemver.major)
            throw new Error('mismatch');
    }
    catch (e) {
        const nodeModules = path.join(installDir, 'node_modules');
        console.log('Node version mismatch, missing, or corrupt. Clearing node_modules.');
        rimrafSync(nodeModules);
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
    const { installDir, volume } = cwdInstallDir();
    if (!installVersion) {
        try {
            installVersion = fs.readFileSync(path.join(volume, VERSION_FILE)).toString().trim();
        }
        catch (e) {
        }
    }

    const options = ((): { install: true; version: string } | { install: false } => {
        if (installVersion) {
            console.log(`Installing @scrypted/server@${installVersion}`);
            return {
                install: true, 
                version: installVersion
            };
        }

        if (!fs.existsSync('node_modules/@scrypted/server')) {
            console.log('Package @scrypted/server not found. Installing.');
            return {
                install: true,
                version: 'latest',
            };
        }

        return {
            install: false,
        }
    })();


    if (options.install) {
        await installServe(options.version, true);
    }

    // todo: remove at some point after core lxc updater rolls out.
    if (process.env.SCRYPTED_INSTALL_ENVIRONMENT === 'lxc')
        process.env.SCRYPTED_FFMPEG_PATH = '/usr/bin/ffmpeg';

    process.env.SCRYPTED_NPM_SERVE = 'true';
    process.env.SCRYPTED_VOLUME = volume;
    process.env.SCRYPTED_CAN_EXIT = 'true';
    process.env.SCRYPTED_CAN_RESTART = 'true';
    console.log('cwd', process.cwd());

    while (true) {
        rimrafSync(EXIT_FILE);
        rimrafSync(UPDATE_FILE);

        await startServer(installDir);

        if (fs.existsSync(UPDATE_FILE)) {
            console.log('Update requested. Installing.');
            await runCommandEatError('npm', '--prefix', installDir, 'install', '--production', '@scrypted/server@latest').catch(e => {
                console.error('Update failed', e);
            });
            console.log('Exiting.');
            process.exit(1);
        }
        else if (fs.existsSync(EXIT_FILE)) {
            console.log('Exiting.');
            process.exit(1);
        }
        else {
            console.log(`Service unexpectedly exited. Restarting momentarily.`);
            await sleep(10000);
        }
    }
}
