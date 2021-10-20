import child_process from 'child_process';
import { once } from 'events';
import fs from 'fs';
import rimraf from 'rimraf';

async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const EXIT_FILE = '.exit';
const UPDATE_FILE = '.update';

async function runCommand(command: string) {
    const cp = child_process.exec(command);
    await once(cp, 'exit');
}

async function runCommandEatError(command: string) {
    try {
        await runCommand(command);
    }
    catch (e) {
        console.warn(command, 'command exited with error, ignoring', e)
    }
}

async function main() {
    while (true) {
        rimraf.sync(EXIT_FILE);
        rimraf.sync(UPDATE_FILE);

        try {
            console.log('starting scrypted main...');
            await runCommand('npm run serve-no-build')
        }
        catch (e) {
            console.error('scrypted server exited with error', e);
        }

        if (fs.existsSync(EXIT_FILE)) {
            console.log(`${EXIT_FILE} found. exiting.`);
            process.exit();
        }

        if (fs.existsSync(UPDATE_FILE)) {
            console.log(`${UPDATE_FILE} found. pulling and rebuilding.`);
            await runCommandEatError('git reset --hard');
            await runCommandEatError('git pull');
            await runCommandEatError('npm install');
            await runCommandEatError('npm run build');
        }

        console.log(`${EXIT_FILE} not found. restarting momentarily.`);
        sleep(10000);
    }
}

main();
