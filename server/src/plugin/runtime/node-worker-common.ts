import AdmZip from 'adm-zip';
import fs from 'fs';
import path from 'path';

function createAdmZipHash(hash: string) {
    const extractVersion = "1-";
    return extractVersion + hash;
}

function prep(pluginVolume: string, hash: string) {
    hash = createAdmZipHash(hash);

    const zipFilename = `${hash}.zip`;
    const zipDir = path.join(pluginVolume, 'zip');
    const zipFile = path.join(zipDir, zipFilename);
    const unzippedPath = path.join(zipDir, 'unzipped')
    const zipDirTmp = zipDir + '.tmp';

    return {
        unzippedPath,
        zipFilename,
        zipDir,
        zipFile,
        zipDirTmp,
    };
}

export async function prepareZip(pluginVolume: string, h: string, getZip: () => Promise<Buffer>) {
    const { zipFile, unzippedPath } = prep(pluginVolume, h);
    if (fs.existsSync(zipFile)) {
        return {
            zipFile,
            unzippedPath,
        }
    }

    const zipBuffer = await getZip();
    return extractZip(pluginVolume, h, zipBuffer);
}

export function prepareZipSync(pluginVolume: string, h: string, getZip: () => Buffer) {
    const { zipFile, unzippedPath } = prep(pluginVolume, h);
    if (fs.existsSync(zipFile)) {
        return {
            zipFile,
            unzippedPath,
        }
    }

    const zipBuffer = getZip();
    return extractZip(pluginVolume, h, zipBuffer);
}

export function extractZip(pluginVolume: string, h: string, zipBuffer: Buffer) {
    const { zipDir, zipDirTmp, zipFilename, zipFile, unzippedPath } = prep(pluginVolume, h);

    fs.rmSync(zipDirTmp, {
        recursive: true,
        force: true,
    });
    fs.rmSync(zipDir, {
        recursive: true,
        force: true,
    });
    fs.mkdirSync(zipDirTmp, {
        recursive: true,
    });
    fs.writeFileSync(path.join(zipDirTmp, zipFilename), zipBuffer);
    const admZip = new AdmZip(zipBuffer);
    admZip.extractAllTo(path.join(zipDirTmp, 'unzipped'), true);
    fs.renameSync(zipDirTmp, zipDir);

    return {
        zipFile,
        unzippedPath,
    }
}
