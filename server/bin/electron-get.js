const path = require('path');
const extract = require('extract-zip');
const { download } = require('@electron/get');
const fs = require('fs');

const version = '31.4.0';
const binDir = path.join(__dirname, '..', 'electron', 'bin', version);
const tmpDir = path.join(binDir, 'tmp');
const targetDir = path.join(binDir, 'target');

let electronBin;
switch (process.platform) {
    case 'mas':
    case 'darwin':
        electronBin = 'Electron.app/Contents/MacOS/Electron';
        break;
    case 'freebsd':
    case 'openbsd':
    case 'linux':
        electronBin = 'electron';
        break;
    case 'win32':
        electronBin = 'electron.exe';
        break;
    default:
        console.warn('Electron builds are not available on platform: ' + process.platform);
}

module.exports.version = version;
module.exports.electronBin = electronBin ? path.join(targetDir, electronBin) : undefined;

function extractFile(zipPath) {
    const distPath = process.env.ELECTRON_OVERRIDE_DIST_PATH || path.join(__dirname, 'dist');

    return extract(zipPath, { dir: tmpDir }).then(() => {
        // If the zip contains an "electron.d.ts" file,
        // move that up
        const srcTypeDefPath = path.join(distPath, 'electron.d.ts');
        const targetTypeDefPath = path.join(__dirname, 'electron.d.ts');
        const hasTypeDefinitions = fs.existsSync(srcTypeDefPath);

        if (hasTypeDefinitions) {
            fs.renameSync(srcTypeDefPath, targetTypeDefPath);
        }
    });
}

module.exports.installElectron = function installElectron() {
    return download(version).then(async zipPath => {
        console.log('electron zip', zipPath);
        if (fs.existsSync(targetDir)) {
            console.log('electron already downloaded', targetDir);
            return;
        }
        fs.rmSync(binDir, { recursive: true, force: true });
        await extractFile(zipPath);
        fs.renameSync(tmpDir, targetDir);
        console.log('electron downloaded', targetDir);
    });
}
