#!/usr/bin/env node

import { connectScryptedClient } from '@scrypted/client';
import { FFmpegInput, ScryptedMimeTypes } from '@scrypted/types';
import child_process from 'child_process';
import fs from 'fs';
import path from 'path';
import readline from 'readline-sync';
import semver from 'semver';
import { httpFetch } from '../../../server/src/fetch/http-fetch';
import { installServe, serveMain } from './service';
import { connectShell } from './shell';
import { convertRtspToMp4, printRtspUsage } from './rtsp-file';

if (!semver.gte(process.version, '16.0.0')) {
    throw new Error('"node" version out of date. Please update node to v16 or higher.')
}

function getUserHome() {
    const ret = process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'];
    if (!ret)
        throw new Error('Neither USERPROFILE or HOME are defined.');
    return ret;
}

const scryptedHome = path.join(getUserHome(), '.scrypted');
const loginPath = path.join(scryptedHome, 'login.json');

function toIpAndPort(ip: string) {
    if (ip.indexOf(':') === -1)
        ip += ':10443'
    return ip;
}

interface Login {
    username: string;
    token: string;
}

interface LoginFile {
    [host: string]: Login;
}

function basicAuthHeaders(username: string, password: string) {
    const headers = new Headers();
    headers.set('Authorization', `Basic ${Buffer.from(username + ":" + password).toString('base64')}`);
    return headers;
}

async function doLogin(host: string) {
    host = toIpAndPort(host);

    const username = readline.question('username: ');
    const password = readline.question('password: ', {
        hideEchoBack: true,
    });

    const url = `https://${host}/login`;
    const response = await httpFetch({
        method: 'GET',
        headers: basicAuthHeaders(username, password),
        url,
        rejectUnauthorized: false,
        responseType: 'json',
    });
    if (response.body.error)
        throw new Error(response.body.error);

    fs.mkdirSync(scryptedHome, {
        recursive: true,
    });
    let login: LoginFile;
    try {
        login = JSON.parse(fs.readFileSync(loginPath).toString());
    }
    catch (e) {
        login = {};
    }
    if (typeof login !== 'object')
        login = {};
    login = login || {};

    login[host] = response.body;
    fs.writeFileSync(loginPath, JSON.stringify(login));
    return login[host];
}

async function getOrDoLogin(host: string): Promise<Login> {
    let login: LoginFile;
    try {
        login = JSON.parse(fs.readFileSync(loginPath).toString());
        if (typeof login !== 'object')
            login = {};

        if (!login[host].username || !login[host].token)
            throw new Error();

        return login[host];
    }
    catch (e) {
        return doLogin(host);
    }
}

async function runCommand() {
    const [idOrName, optionalHost] = process.argv[3].split('@');
    const host = toIpAndPort(optionalHost || '127.0.0.1');

    const login = await getOrDoLogin(host);

    const sdk = await connectScryptedClient({
        baseUrl: `https://${host}`,
        pluginId: '@scrypted/core',
        username: login.username,
        password: login.token,
    });

    const device: any = sdk.systemManager.getDeviceById(idOrName) || sdk.systemManager.getDeviceByName(idOrName);
    if (!device)
        throw new Error('device not found: ' + idOrName);
    const method = process.argv[4];
    const args = process.argv.slice(5).map(arg => {
        try {
            return JSON.parse(arg);
        }
        catch (e) {
        }
        return arg;
    });

    return {
        sdk,
        pendingResult: device[method](...args),
    };
}

async function main() {
    if (process.argv[2] === 'serve') {
        await serveMain();
    }
    else if (process.argv[2]?.startsWith('serve@')) {
        const installVersion = process.argv[2].split('@', 2)[1];
        await serveMain(installVersion);
    }
    else if (process.argv[2] === 'install-server') {
        console.log('install-server version:', process.argv[3]);
        const installDir = await installServe(process.argv[3] || 'latest');
        console.log('server installation successful:', installDir);
    }
    else if (process.argv[2] === 'login') {
        const ip = process.argv[3] || '127.0.0.1';
        const login = await doLogin(ip);
        console.log('login successful. token:', login.token);
    }
    else if (process.argv[2] === 'command') {
        const { sdk, pendingResult } = await runCommand();
        sdk.disconnect();
    }
    else if (process.argv[2] === 'ffplay') {
        const { sdk, pendingResult } = await runCommand();
        const ffmpegInput = await sdk.mediaManager.convertMediaObjectToJSON<FFmpegInput>(await pendingResult, ScryptedMimeTypes.FFmpegInput);
        if (ffmpegInput.url && ffmpegInput.urls?.[0]) {
            const url = new URL(ffmpegInput.url);
            if (url.hostname === '127.0.0.1' && ffmpegInput.urls?.[0] && ffmpegInput.inputArguments) {
                ffmpegInput.inputArguments = ffmpegInput.inputArguments.map(i => i === ffmpegInput.url && ffmpegInput.urls ? ffmpegInput.urls?.[0] : i);
            }
        }
        const args = ffmpegInput.inputArguments ? [...ffmpegInput.inputArguments] : [];
        console.log('ffplay', ...args);
        child_process.spawn('ffplay', args, {
            stdio: 'inherit',
        });
        sdk.disconnect();
    }
    else if (process.argv[2] === 'rtsp') {
        if (!process.argv[3]) {
            printRtspUsage();
            process.exit(1);
        }

        await convertRtspToMp4(process.argv[3], process.argv[4]);
    }
    else if (process.argv[2] === 'create-cert-json' && process.argv.length === 5) {
        const key = fs.readFileSync(process.argv[3]).toString();
        const cert = fs.readFileSync(process.argv[4]).toString();
        const json = JSON.stringify({
            key,
            cert,
        }, null, 2);

        fs.writeFileSync('cert.json', json);
        console.log('Saved cert.json.');
        console.log();
        console.log('Start the Scrypted server with the following environment variable:');
        console.log('   SCRYPTED_HTTPS_OPTIONS_FILE=/path/to/cert.json');
        console.log();
        console.log('Docker users will need to mount the cert in a volume and use the following docker run arguments:');
        console.log('   -e SCRYPTED_HTTPS_OPTIONS_FILE=/path/to/cert.json');
    }
    else if (process.argv[2] === 'install') {
        const ip = toIpAndPort(process.argv[4] || '127.0.0.1');
        const pkg = process.argv[3];

        if (!pkg) {
            console.log('usage: npx scrypted install npm-package-name [ip]');
            process.exit(1);
        }

        const login = await getOrDoLogin(ip);
        const url = `https://${ip}/web/component/script/install/${pkg}`;
        const response = await httpFetch({
            method: 'POST',
            headers: basicAuthHeaders(login.username, login.token),
            url,
            rejectUnauthorized: false,
            responseType: 'json',
        });
        if (response.body.error)
            throw new Error(response.body.error);

        console.log('install successful. id:', response.body.id);
    }
    else if (process.argv[2] === 'shell') {
        console.log = () => { };

        const host = toIpAndPort(process.argv[3] || '127.0.0.1');
        const login = await getOrDoLogin(host);
        const sdk = await connectScryptedClient({
            baseUrl: `https://${host}`,
            pluginId: '@scrypted/core',
            username: login.username,
            password: login.token,
        });

        const separator = process.argv.indexOf("--");
        const cmd = separator != -1 ? process.argv.slice(separator + 1) : [];
        await connectShell(sdk, ...cmd);
    }
    else {
        console.log('usage:');
        console.log('   npx scrypted install npm-package-name [127.0.0.1[:10443]]');
        console.log('   npx scrypted install npm-package-name[/0.0.1] [127.0.0.1[:10443]]');
        console.log('   npx scrypted login [127.0.0.1[:10443]]');
        console.log('   npx scrypted serve');
        console.log('   npx scrypted serve@latest');
        console.log('   npx scrypted serve[@version]');
        console.log('   npx scrypted command name-or-id[@127.0.0.1[:10443]] method-name [...method-arguments]');
        console.log('   npx scrypted ffplay name-or-id[@127.0.0.1[:10443]] method-name [...method-arguments]');
        console.log('   npx scrypted create-cert-json /path/to/key.pem /path/to/cert.pem');
        console.log('   npx scrypted shell [127.0.0.1[:10443]] [-- cmd [...cmd-args]]');
        console.log();
        console.log('examples:');
        console.log('   npx scrypted install @scrypted/rtsp');
        console.log('   npx scrypted install @scrypted/rtsp/0.0.51');
        console.log('   npx scrypted install @scrypted/rtsp/0.0.51 192.168.2.100');
    }
}

main();
