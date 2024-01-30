import fs from 'fs';
import path from 'path';
import Level from '../level';
import { sleep } from '../sleep';
import { getPluginsVolume, getScryptedVolume } from '../plugin/plugin-volume';
import AdmZip from 'adm-zip';
import { ScryptedRuntime } from '../runtime';
import { getPluginNodePath } from '../plugin/plugin-npm-dependencies';

export class Backup {
    constructor(public runtime: ScryptedRuntime) {}

    async createBackup(): Promise<Buffer> {
        const volumeDir = getScryptedVolume();

        const backupDbPath = path.join(volumeDir, 'backup.db');
        await fs.promises.rm(backupDbPath, {
            recursive: true,
            force: true,
        });

        const backupDb = new Level(backupDbPath);
        await backupDb.open();
        for await (const [key, value] of this.runtime.datastore.iterator()) {
            await backupDb.put(key, value);
        }
        await backupDb.close();

        const backupZip = path.join(volumeDir, 'backup.zip');
        await fs.promises.rm(backupZip, {
            recursive: true,
            force: true,
        });

        const zip = new AdmZip();
        await zip.addLocalFolderPromise(backupDbPath, {});
        return zip.toBufferPromise();
    }

    async restore(b: Buffer): Promise<void> {
        const volumeDir = getScryptedVolume();
        const dbPath = path.join(volumeDir, 'scrypted.db');

        const zip = new AdmZip(b);
        if (!zip.test())
            throw new Error('backup zip test failed.');

        this.runtime.kill();
        await sleep(5000);
        await this.runtime.datastore.close();

        // nuke the existing database path
        await fs.promises.rm(dbPath, {
            recursive: true,
            force: true,
        });

        // nuke all the plugins and associated files downloaded by thhem.
        // first run after restore will reinstall everything.
        await fs.promises.rm(getPluginsVolume(), {
            recursive: true,
            force: true,
        });

        zip.extractAllTo(dbPath, true);
        this.runtime.serviceControl.restart();
    }
}