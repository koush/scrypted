#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import axios, { AxiosRequestConfig } from 'axios';
import util from 'util';
import readline, { BasicOptions } from 'readline-sync';
import https from 'https';
import mkdirp from 'mkdirp';

function getUserHome() {
    const ret = process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'];
    if (!ret)
        throw new Error('Neither USERPROFILE or HOME are defined.');
    return ret;
}

const axiosConfig: AxiosRequestConfig = {
    httpsAgent: new https.Agent({
        rejectUnauthorized: false
    })
}

async function main() {
    if (process.argv[2] === 'install') {
        const ip = process.argv[4] || '127.0.0.1';
        const pkg = process.argv[3];

        if (!pkg) {
            console.log('usage: npx scrypted install npm-package-name [ip]');
            process.exit(1);
        }

        const scryptedHome = path.join(getUserHome(), '.scrypted');
        const loginPath = path.join(scryptedHome, 'login.json');
        let username: string;
        let password: string;
        let login: any;
        try {
            login = JSON.parse(fs.readFileSync(loginPath).toString());
            if (typeof login !== 'object')
                login = {};
                
            if (!login[ip].username || !login[ip].token)
                throw new Error();
            username = login[ip].username;
            password = login[ip].token;
        }
        catch (e) {
            username = readline.question('username: ');
            password = readline.question('password: ', {
                hideEchoBack: true,
            });

            const url = `https://${ip}:9443/login`;
            const authedConfig = Object.assign({
                method: 'GET',
                auth: {
                    username,
                    password,
                },
                url,
            }, axiosConfig);
            const response = await axios(authedConfig);
            
            mkdirp.sync(scryptedHome);
            login = login || {};
            login[ip] = response.data;
            fs.writeFileSync(loginPath, JSON.stringify(login));
        }

        const url = `https://${ip}:9443/web/component/script/install/${pkg}`;
        const response = await axios.post(url, undefined, Object.assign({
            method: 'GET',
            auth: {
                username: login[ip].username,
                password: login[ip].token,
            },
            url,
        }, axiosConfig));

        console.log('install successful. id:',response.data.id);
   }
    else {
        console.log('usage: npx scrypted install npm-package-name');
        process.exit(1);
    }
}

main();
