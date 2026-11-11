import AdmZip from 'adm-zip';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';

/** The Hikvision SDK the user uploaded, as installed under the plugin volume. */
export interface SdkInfo
{
    version: string;
    arch: 'arm64' | 'x64';
    libDir: string;
    installedAt: string;
}

export class SdkInstallError extends Error
{
}

const LIB_NAME = 'libhcnetsdk.so';
const COM_DIR = 'HCNetSDKCom/';
const INSTALL_DIR = 'hcnetsdk';
const INFO_FILE = 'sdk.json';
// kept across reinstalls: the observation-run log lives next to the SDK
const PRESERVED_FILES = ['diagnostics.jsonl', 'diagnostics.jsonl.1'];
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
// real SDK lib folders unpack to well under 100 MB
const MAX_EXTRACT_BYTES = 500 * 1024 * 1024;

/** Architecture of an ELF binary from its header (e_machine at offset 18). */
export function elfArch (header: Buffer): 'arm64' | 'x64' | undefined
{
    if (header.length < 20 || header.readUInt32BE (0) !== 0x7f454c46) {
        return undefined;
    }
    switch (header.readUInt16LE (18)) {
        case 183: return 'arm64';
        case 62: return 'x64';
        default: return undefined;
    }
}

/**
 * Installs the lib folder of a Device Network SDK zip (the folder holding
 * libhcnetsdk.so and HCNetSDKCom/) into <volumeDir>/hcnetsdk, replacing any
 * previous install. Throws SdkInstallError with a user-facing reason.
 */
export async function installSdkZip (zip: Buffer, volumeDir: string, arch: string, maxExtractBytes = MAX_EXTRACT_BYTES): Promise<SdkInfo>
{
    let entries: AdmZip.IZipEntry[];
    try {
        entries = new AdmZip (zip).getEntries();
    }
    catch {
        throw new SdkInstallError ('This is not a zip file. Upload the SDK zip exactly as downloaded.');
    }

    const libDirs = entries
        .filter ((e) => !e.isDirectory && posix.basename (e.entryName) === LIB_NAME)
        .map ((e) => e.entryName.slice (0, -LIB_NAME.length));
    if (!libDirs.length) {
        throw new SdkInstallError (`The zip has no ${LIB_NAME}. Upload the Linux package (ArmLinux64 or Linux64), not the Windows one.`);
    }
    const withCom = libDirs.filter ((dir) => entries.some ((e) => e.entryName.startsWith (dir + COM_DIR)));
    if (!withCom.length) {
        throw new SdkInstallError (`The zip has no ${COM_DIR.slice (0, -1)} folder next to ${LIB_NAME}.`);
    }
    const libDir = withCom.sort ((a, b) => a.length - b.length)[0];

    const found = elfArch (entries.find ((e) => e.entryName === libDir + LIB_NAME).getData());
    if (!found) {
        throw new SdkInstallError (`${LIB_NAME} in the zip is not a Linux arm64 or x64 library.`);
    }
    if (found !== arch) {
        throw new SdkInstallError (`The zip holds the ${found} SDK, but this Scrypted server is ${arch}. `
            + `Download the ${arch === 'arm64' ? 'ArmLinux64' : 'Linux64'} package instead.`);
    }

    const unpackedBytes = entries
        .filter ((e) => !e.isDirectory && e.entryName.startsWith (libDir))
        .reduce ((sum, e) => sum + e.header.size, 0);
    if (unpackedBytes > maxExtractBytes) {
        throw new SdkInstallError (`The SDK folder in the zip unpacks to more than ${Math.round (maxExtractBytes / 1024 / 1024)} MB, which is not a Hikvision SDK.`);
    }

    const finalDir = join (volumeDir, INSTALL_DIR);
    const tmpDir = join (volumeDir, INSTALL_DIR + '.tmp');
    rmSync (tmpDir, { recursive: true, force: true });
    mkdirSync (tmpDir, { recursive: true });
    try {
        for (const entry of entries) {
            if (entry.isDirectory || !entry.entryName.startsWith (libDir)) {
                continue;
            }
            const relative = posix.normalize (entry.entryName.slice (libDir.length));
            if (relative.startsWith ('../') || relative.startsWith ('/') || relative === '..') {
                continue;
            }
            const target = join (tmpDir, relative);
            mkdirSync (dirname (target), { recursive: true });
            if (((entry.attr >>> 16) & S_IFMT) === S_IFLNK) {
                // only links to a sibling file (libcrypto.so -> libcrypto.so.1.1)
                const linkTarget = entry.getData().toString();
                if (!linkTarget.includes ('/') && linkTarget !== '.' && linkTarget !== '..') {
                    symlinkSync (linkTarget, target);
                }
            }
            else {
                writeFileSync (target, entry.getData());
            }
        }

        const version = entries.map ((e) => /HCNetSDKV(\d+(?:\.\d+){3}(?:_build\d+)?)/.exec (e.entryName)?.[1]).find (Boolean) ?? 'unknown';
        const installedAt = new Date().toISOString();
        writeFileSync (join (tmpDir, INFO_FILE), JSON.stringify ({ version, arch: found, installedAt }, null, 2));

        for (const name of PRESERVED_FILES) {
            if (existsSync (join (finalDir, name))) {
                renameSync (join (finalDir, name), join (tmpDir, name));
            }
        }
        rmSync (finalDir, { recursive: true, force: true });
        renameSync (tmpDir, finalDir);
        return { version, arch: found, libDir: finalDir, installedAt };
    }
    catch (e) {
        rmSync (tmpDir, { recursive: true, force: true });
        throw e;
    }
}

/** The installed SDK when it matches this server's architecture. */
export function getInstalledSdk (volumeDir: string, arch: string): SdkInfo | undefined
{
    const libDir = join (volumeDir, INSTALL_DIR);
    try {
        const info = JSON.parse (readFileSync (join (libDir, INFO_FILE), 'utf8'));
        if (info.arch !== arch || !existsSync (join (libDir, LIB_NAME))) {
            return undefined;
        }
        return { version: info.version, arch: info.arch, libDir, installedAt: info.installedAt };
    }
    catch {
        return undefined;
    }
}

/** Whether SDK push can run on this server; polling covers everything else. */
export function pushSupport (platform: string, arch: string, hasPython: boolean): { supported: true } | { supported: false; reason: string }
{
    if (platform !== 'linux') {
        return { supported: false, reason: `Push needs a Linux Scrypted server, this one runs ${platform}.` };
    }
    if (arch !== 'arm64' && arch !== 'x64') {
        return { supported: false, reason: `Push needs an arm64 or x64 server, this one is ${arch}.` };
    }
    if (!hasPython) {
        return { supported: false, reason: 'Push needs python3 on the Scrypted server.' };
    }
    return { supported: true };
}
