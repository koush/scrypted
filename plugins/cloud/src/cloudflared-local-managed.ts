import * as cloudflared from 'cloudflared';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import child_process from 'child_process';
import { once } from 'events';
import { timeoutPromise } from '@scrypted/common/src/promise-utils';

function extractJsonFilePath(message: string): string | null {
    const regex = /Tunnel credentials written to (.+?\.json)/;
    const match = message.match(regex);
    return match ? match[1] : null;
}

function runLog(bin: string, args: string[]) {
    const cp = child_process.spawn(bin, args, {
        stdio: 'pipe',
    });

    cp.stdio[1].on('data', (data) => {
        console.log(data.toString());
    });
    cp.stdio[2].on('data', (data) => {
        console.error(data.toString());
    });

    return cp;
}

async function runLogWait(bin: string, args: string[], timeout: number, signal?: AbortSignal, outputChanged?: (output: string) => void) {
    const cp = runLog(bin, args);

    signal?.addEventListener('abort', () => {
        cp.kill();
    });

    let output: string = '';
    cp.stdio[1].on('data', (data) => {
        output += data.toString();
        outputChanged?.(output);
    });
    cp.stdio[2].on('data', (data) => {
        output += data.toString();
        outputChanged?.(output);
    });

    await timeoutPromise(timeout, once(cp, 'exit'));
    if (cp.exitCode !== 0)
        throw new Error(`failed: cloudflared ${args.join(' ')}`);

    return output;
}

async function login(bin: string, signal?: AbortSignal, urlCallback?: (url: string) => void) {
    const userHome = process.env.HOME || process.env.USERPROFILE;
    const certPem = path.join(userHome, '.cloudflared', 'cert.pem');
    rmSync(certPem, { force: true, recursive: true });

    await runLogWait(bin, ['tunnel', 'login'], 300000, signal, output => {
        const match = output.match(/Please open the following URL and log in with your Cloudflare account:(?<url>.*?)Leave/s);
        if (match) {
            const url = match.groups.url.trim();
            if (url)
                urlCallback(url);
        }
    });
}

async function createTunnel(bin: string, domain: string) {
    await runLogWait(bin, ['tunnel', 'cleanup', domain], 30000).catch(() => { });
    await runLogWait(bin, ['tunnel', 'delete', domain], 30000).catch(() => { });
    return runLogWait(bin, ['tunnel', 'create', domain], 30000);
}

async function routeDns(bin: string, tunnelId: string, domain: string) {
    return runLogWait(bin, ['tunnel', 'route', "dns", "-f", tunnelId, domain], 30000);
}

export async function runLocallyManagedTunnel(jsonContents: any, url: string, workDir: string, bin?: string) {
    bin = await ensureBin(bin);

    const { TunnelID } = jsonContents;
    const credentialsJson = path.join(workDir, `${TunnelID}.json`);
    writeFileSync(credentialsJson, JSON.stringify(jsonContents));

    const configYml =
        `url: ${url}
tunnel: ${TunnelID}
credentials-file: ${workDir}/${TunnelID}.json
`;

    const configYmlPath = path.join(workDir, `${TunnelID}.yml`);
    writeFileSync(configYmlPath, configYml);


    return runLog(bin, ['tunnel', '--config', configYmlPath, 'run', TunnelID]);
}

async function ensureBin(bin: string) {
    if (bin)
        return bin;
    const dir = path.join(tmpdir(), 'cloudflared');
    bin = path.join(dir, 'cloudflared');
    if (!existsSync(bin)) {
        try {
            mkdirSync(dir, { recursive: true });
        }
        catch (e) {
        }
        const b = await cloudflared.install(bin);
        console.warn(b);
    }
    return bin;
}

export async function createLocallyManagedTunnel(domain: string, bin?: string, signal?: AbortSignal, urlCallback?: (url: string) => void) {
    bin = await ensureBin(bin);

    await login(bin, signal, urlCallback);
    const createOutput = await createTunnel(bin, domain);
    const jsonFilePath = extractJsonFilePath(createOutput);

    const jsonContents = JSON.parse(readFileSync(jsonFilePath).toString());

    const { TunnelID } = jsonContents;
    await routeDns(bin, TunnelID, domain);
    return jsonContents;
}
