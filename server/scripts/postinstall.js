const child_process = require('child_process');
const python = require('@bjia56/portable-python-3.9');
const { once } = require('events');

async function pipInstall(pkg) {
    const cp = child_process.spawn(python, ['-m', 'pip', 'install', pkg], {stdio: 'inherit'});
    const [exitCode] = await once(cp, 'exit');
    if (exitCode)
        throw new Error('non-zero exit code: ' + exitCode);
}

async function installScryptedServerRequirements() {
    await pipInstall('wheel');
    await pipInstall('debugpy');
    await pipInstall('psutil');
    await pipInstall('ptpython');
}

installScryptedServerRequirements();
