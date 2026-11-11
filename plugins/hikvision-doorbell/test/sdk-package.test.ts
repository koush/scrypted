// Synthetic zips shaped like Hikvision's Device Network SDK packages: a top folder
// named after the build (e.g. EN-HCNetSDKV6.1.9.48_build20230410_ArmLinux64) with
// lib/libhcnetsdk.so, lib/HCNetSDKCom/*.so and demo folders that may carry another
// copy of libhcnetsdk.so. The real ArmLinux64 zip could not be listed (download
// needs a Chinese phone-number login); the installer only relies on the lib folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { elfArch, getInstalledSdk, installSdkZip, pushSupport } from '../src/sdk/sdk-package';

const ARM64 = 183;
const X64 = 62;
const TOP = 'EN-HCNetSDKV6.1.9.48_build20230410_ArmLinux64';

function elf (machine: number)
{
    const header = Buffer.alloc (64);
    header.set ([0x7f, 0x45, 0x4c, 0x46], 0);
    header.writeUInt16LE (machine, 18);
    return header;
}

function sdkZip ({ machine = ARM64, withLib = true, withCom = true, extra = {} as Record<string, Buffer> } = {})
{
    const zip = new AdmZip();
    zip.addFile (`${TOP}/Doc/readme.txt`, Buffer.from ('docs'));
    zip.addFile (`${TOP}/Demo/Java/lib/libhcnetsdk.so`, elf (machine));
    if (withLib) {
        zip.addFile (`${TOP}/lib/libhcnetsdk.so`, elf (machine));
        zip.addFile (`${TOP}/lib/libHCCore.so`, elf (machine));
    }
    if (withCom) {
        zip.addFile (`${TOP}/lib/HCNetSDKCom/libHCAlarm.so`, elf (machine));
    }
    for (const [name, data] of Object.entries (extra)) {
        zip.addFile (name, data);
    }
    return zip.toBuffer();
}

function withVolume (run: (volume: string) => Promise<void>)
{
    return async () => {
        const volume = mkdtempSync (join (tmpdir(), 'hik-sdk-'));
        try {
            await run (volume);
        }
        finally {
            rmSync (volume, { recursive: true, force: true });
        }
    };
}

test('elfArch reads the machine field', () => {
    assert.equal (elfArch (elf (ARM64)), 'arm64');
    assert.equal (elfArch (elf (X64)), 'x64');
    assert.equal (elfArch (elf (40)), undefined);
    assert.equal (elfArch (Buffer.from ('MZ not an elf file at all')), undefined);
});

test('installs arm64 zip and reports version', withVolume (async (volume) => {
    const info = await installSdkZip (sdkZip(), volume, 'arm64');
    assert.equal (info.version, '6.1.9.48_build20230410');
    assert.equal (info.arch, 'arm64');
    assert.ok (info.libDir.endsWith ('hcnetsdk'));
    assert.ok (existsSync (join (info.libDir, 'libhcnetsdk.so')));
    assert.ok (existsSync (join (info.libDir, 'HCNetSDKCom', 'libHCAlarm.so')));
    assert.ok (!existsSync (join (info.libDir, 'Demo')));
    assert.ok (existsSync (join (info.libDir, 'sdk.json')));
    assert.deepEqual (getInstalledSdk (volume, 'arm64'), info);
    assert.equal (getInstalledSdk (volume, 'x64'), undefined);
}));

test('rejects zip for other architecture', withVolume (async (volume) => {
    await assert.rejects (installSdkZip (sdkZip ({ machine: X64 }), volume, 'arm64'),
        (e: Error) => e.message.includes ('x64') && e.message.includes ('arm64'));
    assert.equal (getInstalledSdk (volume, 'arm64'), undefined);
}));

test('rejects zip without libhcnetsdk.so', withVolume (async (volume) => {
    const zip = new AdmZip();
    zip.addFile ('EN-HCNetSDKV6.1.9.48_build20230410_Win64/lib/HCNetSDK.dll', Buffer.from ('MZ'));
    await assert.rejects (installSdkZip (zip.toBuffer(), volume, 'arm64'), /libhcnetsdk\.so/);
}));

test('rejects zip without HCNetSDKCom', withVolume (async (volume) => {
    await assert.rejects (installSdkZip (sdkZip ({ withCom: false }), volume, 'arm64'), /HCNetSDKCom/);
}));

test('rejects non-zip bytes', withVolume (async (volume) => {
    await assert.rejects (installSdkZip (Buffer.from ('<html>login</html>'), volume, 'arm64'), /not a zip file/);
}));

test('ignores entries that escape the lib folder', withVolume (async (volume) => {
    // adm-zip cleans '..' when adding, so patch the stored names afterwards
    const zip = sdkZip ({ extra: { [`${TOP}/lib/aa/aa/evil.so`]: elf (ARM64) } });
    for (let i = zip.indexOf ('aa/aa'); i >= 0; i = zip.indexOf ('aa/aa')) {
        zip.write ('../..', i);
    }
    assert.ok (new AdmZip (zip).getEntries().some ((e) => e.entryName === `${TOP}/lib/../../evil.so`));
    // extracted naively, hcnetsdk.tmp/../../evil.so would land next to the volume
    const escaped = join (volume, '..', 'evil.so');
    try {
        const info = await installSdkZip (zip, volume, 'arm64');
        assert.ok (!existsSync (escaped));
        assert.ok (existsSync (join (info.libDir, 'libhcnetsdk.so')));
    }
    finally {
        rmSync (escaped, { force: true });
    }
}));

test('keeps same-folder symlinks, drops others', withVolume (async (volume) => {
    const zip = new AdmZip (sdkZip());
    zip.addFile (`${TOP}/lib/libcrypto.so.1.1`, elf (ARM64));
    for (const [name, target] of [['libcrypto.so', 'libcrypto.so.1.1'], ['etc', '/etc'], ['up', '../..']]) {
        zip.addFile (`${TOP}/lib/${name}`, Buffer.from (target));
        // addFile keeps only permission bits, so mark the entry as a symlink afterwards
        zip.getEntry (`${TOP}/lib/${name}`).attr = (0o120777 << 16) >>> 0;
    }
    const info = await installSdkZip (zip.toBuffer(), volume, 'arm64');
    assert.equal (readlinkSync (join (info.libDir, 'libcrypto.so')), 'libcrypto.so.1.1');
    assert.ok (!existsSync (join (info.libDir, 'etc')));
    assert.ok (!existsSync (join (info.libDir, 'up')));
}));

test('reinstall replaces previous files',withVolume (async (volume) => {
    const first = await installSdkZip (sdkZip(), volume, 'arm64');
    writeFileSync (join (first.libDir, 'stale.so'), 'old');
    writeFileSync (join (first.libDir, 'diagnostics.jsonl'), '{"kind":"sdk"}\n');
    const second = await installSdkZip (sdkZip(), volume, 'arm64');
    assert.ok (!existsSync (join (second.libDir, 'stale.so')));
    assert.ok (existsSync (join (second.libDir, 'libhcnetsdk.so')));
    assert.equal (readFileSync (join (second.libDir, 'diagnostics.jsonl'), 'utf8'), '{"kind":"sdk"}\n');
    assert.ok (!existsSync (join (volume, 'hcnetsdk.tmp')));
}));

test('push unsupported off linux, on other arches or without python', () => {
    for (const [platform, arch, python] of [['darwin', 'arm64', true], ['linux', 'ia32', true], ['linux', 'arm64', false]] as const) {
        const result = pushSupport (platform, arch, python);
        assert.equal (result.supported, false);
        assert.ok (!result.supported && result.reason.length > 0);
    }
    assert.deepEqual (pushSupport ('linux', 'arm64', true), { supported: true });
    assert.deepEqual (pushSupport ('linux', 'x64', true), { supported: true });
});

test('rejects a lib folder that unpacks beyond the size cap', withVolume (async (volume) => {
    const zip = sdkZip ({ extra: { [`${TOP}/lib/big.so`]: Buffer.alloc (4096) } });
    await assert.rejects (installSdkZip (zip, volume, 'arm64', 2048), /unpacks to more than/);
    assert.equal (getInstalledSdk (volume, 'arm64'), undefined);
}));
