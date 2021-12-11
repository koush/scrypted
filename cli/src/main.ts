#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import axios, { AxiosRequestConfig } from 'axios';
import readline from 'readline-sync';
import https from 'https';
import mkdirp from 'mkdirp';
import { installServe, serveMain } from './service';

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

async function doLogin(ip: string) {
    ip = toIpAndPort(ip);

    const username = readline.question('username: ');
    const password = readline.question('password: ', {
        hideEchoBack: true,
    });

    const url = `https://${ip}/login`;
    const response = await axios(Object.assign({
        method: 'GET',
        auth: {
            username,
            password,
        },
        url,
    }, axiosConfig));

    mkdirp.sync(scryptedHome);
    let login: any;
    try {
        login = JSON.parse(fs.readFileSync(loginPath).toString());
    }
    catch (e) {
        login = {};
    }
    if (typeof login !== 'object')
        login = {};
    login = login || {};

    login[ip] = response.data;
    fs.writeFileSync(loginPath, JSON.stringify(login));
    return login;
}

const axiosConfig: AxiosRequestConfig = {
    httpsAgent: new https.Agent({
        rejectUnauthorized: false
    })
}

async function main() {
    if (process.argv[2] === 'serve') {
        await serveMain(false);
    }
    else if (process.argv[2] === 'serve@latest') {
        await serveMain(true);
    }
    else if (process.argv[2] === 'install-server') {
        const installDir = await installServe();
        console.log('server installation successful:', installDir);
    }
    else if (process.argv[2] === 'login') {
        const ip = process.argv[3] || '127.0.0.1';
        await doLogin(ip);
        console.log('login successful.')
    }
    else if (process.argv[2] === 'install') {
        const ip = toIpAndPort(process.argv[4] || '127.0.0.1');
        const pkg = process.argv[3];

        if (!pkg) {
            console.log('usage: npx scrypted install npm-package-name [ip]');
            process.exit(1);
        }

        let login: any;
        try {
            login = JSON.parse(fs.readFileSync(loginPath).toString());
            if (typeof login !== 'object')
                login = {};

            if (!login[ip].username || !login[ip].token)
                throw new Error();
        }
        catch (e) {
            login = await doLogin(ip);
        }

        const url = `https://${ip}/web/component/script/install/${pkg}`;
        const response = await axios(Object.assign({
            method: 'POST',
            auth: {
                username: login[ip].username,
                password: login[ip].token,
            },
            url,
        }, axiosConfig));

        console.log('install successful. id:', response.data.id);
    }
    else {
        console.log('usage:');
        console.log('   npx scrypted install npm-package-name [127.0.0.1[:10443]]');
        console.log('   npx scrypted login [127.0.0.1[:10443]]');
        console.log('   npx scrypted serve');
        console.log('   npx scrypted serve@latest');
        process.exit(1);
    }
}

main();
