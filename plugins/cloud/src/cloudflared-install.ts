import * as cloudflared from 'cloudflared';
import { once } from 'events';
import fs, { mkdirSync, renameSync, rmSync } from 'fs';
import path from 'path';
import { httpFetch } from '../../../server/src/fetch/http-fetch';

export async function installCloudflared() {
    const pluginVolume = process.env.SCRYPTED_PLUGIN_VOLUME;
    const version = 5;
    const cloudflareD = path.join(pluginVolume, 'cloudflare.d', `v${version}`, `${process.platform}-${process.arch}`);
    const bin = path.join(cloudflareD, cloudflared.bin);

    if (!fs.existsSync(bin)) {
        for (let i = 0; i <= version; i++) {
            const cloudflareD = path.join(pluginVolume, 'cloudflare.d', `v${version}`);
            rmSync(cloudflareD, {
                force: true,
                recursive: true,
            });
        }
        await cloudflared.install(bin);
    }

    return {
        bin,
        cloudflareD,
    };
}
