const child_process = require('child_process');
const { PortablePython } = require('py')
const { once } = require('events');

module.exports = {
    version: '3.10',
}

async function pipInstall(python, pkg) {
    const cp = child_process.spawn(python, ['-m', 'pip', 'install', pkg], { stdio: 'inherit' });
    const [exitCode] = await once(cp, 'exit');
    if (exitCode)
        throw new Error('non-zero exit code: ' + exitCode);
}

module.exports.installScryptedServerRequirements = async function installScryptedServerRequirements(version, dest, options) {
    const py = new PortablePython(version || require('./packaged-python').version, dest, options);
    await py.install();
    let python = py.executablePath;

    await pipInstall(python, 'debugpy');
    return python;
}
