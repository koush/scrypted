#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const fs_1 = (0, tslib_1.__importDefault)(require("fs"));
const path_1 = (0, tslib_1.__importDefault)(require("path"));
const axios_1 = (0, tslib_1.__importDefault)(require("axios"));
const readline_sync_1 = (0, tslib_1.__importDefault)(require("readline-sync"));
const https_1 = (0, tslib_1.__importDefault)(require("https"));
const mkdirp_1 = (0, tslib_1.__importDefault)(require("mkdirp"));
function getUserHome() {
    const ret = process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'];
    if (!ret)
        throw new Error('Neither USERPROFILE or HOME are defined.');
    return ret;
}
const axiosConfig = {
    httpsAgent: new https_1.default.Agent({
        rejectUnauthorized: false
    })
};
function main() {
    return (0, tslib_1.__awaiter)(this, void 0, void 0, function* () {
        if (process.argv[2] === 'install') {
            const ip = process.argv[4] || '127.0.0.1';
            const pkg = process.argv[3];
            if (!pkg) {
                console.log('usage: npx scrypted install npm-package-name [ip]');
                process.exit(1);
            }
            const scryptedHome = path_1.default.join(getUserHome(), '.scrypted');
            const loginPath = path_1.default.join(scryptedHome, 'login.json');
            let login;
            try {
                login = JSON.parse(fs_1.default.readFileSync(loginPath).toString());
            }
            catch (e) {
                const username = readline_sync_1.default.question('username: ');
                const password = readline_sync_1.default.question('password: ', {
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
                const response = yield (0, axios_1.default)(authedConfig);
                mkdirp_1.default.sync(scryptedHome);
                login = login || {};
                login[ip] = response.data;
                fs_1.default.writeFileSync(loginPath, JSON.stringify(loginPath));
            }
            const url = `https://${ip}:9443/web/component/script/install/${pkg}`;
            const response = yield axios_1.default.post(url, undefined, axiosConfig);
            console.log('install successful. id:', response.data.id);
        }
        else {
            console.log('usage: npx scrypted install npm-package-name');
            process.exit(1);
        }
    });
}
main();
//# sourceMappingURL=main.js.map