import * as cloudflared from 'cloudflared';
import { once } from 'events';
import fs, { mkdirSync, renameSync, rmSync } from 'fs';
import path from 'path';
import { httpFetch } from '../../../server/src/fetch/http-fetch';

export async function installCloudflared() {
    const pluginVolume = process.env.SCRYPTED_PLUGIN_VOLUME;
    const version = 2;
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
        if (process.platform === 'darwin' && process.arch === 'arm64') {
            const bin = path.join(cloudflareD, cloudflared.bin);
            mkdirSync(path.dirname(bin), {
                recursive: true,
            });
            const tmp = `${bin}.tmp`;

            const stream = await httpFetch({
                url: 'https://github.com/scryptedapp/cloudflared/releases/download/2023.8.2/cloudflared-darwin-arm64',
                responseType: 'readable',
            });
            const write = stream.body.pipe(fs.createWriteStream(tmp));
            await once(write, 'close');
            renameSync(tmp, bin);
            fs.chmodSync(bin, 0o0755)
        }
        else {
            await cloudflared.install(bin);
        }
    }

    return {
        bin,
        cloudflareD,
    };
}
