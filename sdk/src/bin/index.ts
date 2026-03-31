import https from 'https';
import axios from 'axios';
import process from 'process';
import path from 'path';
import fs from 'fs';

function getUserHome(): string {
    const ret = process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'];
    if (!ret)
        throw new Error('Neither USERPROFILE or HOME are defined.');
    return ret;
}

const scryptedHome = path.join(getUserHome(), '.scrypted');
const loginPath = path.join(scryptedHome, 'login.json');

interface Login {
    username?: string;
    token?: string;
}

interface LoginFile {
    [ip: string]: Login;
}

function getLogin(ip: string): { username: string; password: string } {
    let login: LoginFile;
    try {
        login = JSON.parse(fs.readFileSync(loginPath).toString());
    }
    catch {
        login = {};
    }

    const ipLogin = login[ip];

    return {
        username: ipLogin?.username || '',
        password: ipLogin?.token || '',
    };
}

function showLoginError(): void {
    console.error('Authorization required. Please log in with the following:');
    console.error('     npx scrypted login [ip]');
}

function toIpAndPort(ip: string): string {
    if (ip.indexOf(':') === -1)
        ip += ':10443';
    console.log(ip);
    return ip;
}

export function deploy(debugHost: string, noRebind?: boolean): Promise<void> {
    debugHost = toIpAndPort(debugHost);

    return new Promise((resolve, reject) => {
        let out: string;
        if (process.env.NODE_ENV === 'production')
            out = path.resolve(process.cwd(), 'dist');
        else
            out = path.resolve(process.cwd(), 'out');

        const outFilename = 'plugin.zip';
        const main = path.resolve(out, outFilename);
        if (!fs.existsSync(main)) {
            console.error('npm run scrypted-webpack to build a webpack bundle for Scrypted.');
            reject(new Error(`Missing webpack bundle: ${main}`));
            return;
        }

        const packageJsonPath = path.resolve(process.cwd(), 'package.json');
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath).toString());
        const npmPackage = packageJson.name || '';

        const rebindQuery = noRebind ? 'no-rebind' : '';

        const deployUrl = `https://${debugHost}/web/component/script/deploy?${rebindQuery}&npmPackage=${npmPackage}`;
        const setupUrl = `https://${debugHost}/web/component/script/setup?${rebindQuery}&npmPackage=${npmPackage}`;

        const fileContents = fs.readFileSync(main);
        console.log(`deploying to ${debugHost}`);

        let auth: { username: string; password: string };
        try {
            auth = getLogin(debugHost);
        }
        catch (e) {
            console.error(e);
            showLoginError();
            process.exit(1);
        }

        const httpsAgent = new https.Agent({
            rejectUnauthorized: false
        });

        axios.post(setupUrl, packageJson,
            {
                auth,
                timeout: 10000,
                maxRedirects: 0,
                httpsAgent,
                validateStatus: function (status: number) {
                    if (status === 401) {
                        showLoginError();
                    }
                    return status >= 200 && status < 300;
                },
            })
            .then(() => {
                console.log(`configured ${debugHost}`);

                return axios.post(deployUrl, fileContents,
                    {
                        auth: getLogin(debugHost),
                        timeout: 10000,
                        maxRedirects: 0,
                        httpsAgent,
                        validateStatus: function (status: number) {
                            return status >= 200 && status < 300;
                        },
                        headers: {
                            "Content-Type": "application/zip "
                        }
                    }
                );
            })
            .then(() => {
                console.log(`deployed to ${debugHost}`);
                resolve();
            })
            .catch((err: Error) => {
                console.error(err.message);
                if (axios.isAxiosError(err) && err.response?.data) {
                    console.log('\x1b[31m%s\x1b[0m', err.response.data);
                }
                reject(err);
            });
    });
}

export function debug(debugHost: string, entryPoint?: string): Promise<void> {
    debugHost = toIpAndPort(debugHost);

    return new Promise((resolve, reject) => {
        const packageJsonPath = path.resolve(process.cwd(), 'package.json');
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath).toString());
        const npmPackage = packageJson.name || '';

        const debugUrl = `https://${debugHost}/web/component/script/debug?npmPackage=${npmPackage}`;
        console.log(`initiating debugger on ${debugHost}`);

        const httpsAgent = new https.Agent({
            rejectUnauthorized: false
        });

        axios.post(debugUrl, undefined, {
            auth: getLogin(debugHost),
            timeout: 10000,
            maxRedirects: 0,
            httpsAgent,
            validateStatus: function (status: number) {
                return status >= 200 && status < 300;
            },
        })
            .then(() => {
                console.log(`debugger ready on ${debugHost}`);
                resolve();
            })
            .catch((err: Error) => {
                console.error(err.message);
                if (axios.isAxiosError(err) && err.response?.data) {
                    console.log('\x1b[31m%s\x1b[0m', err.response.data);
                }
                reject(err);
            });
    });
}

export function getDefaultWebpackConfig(name: string): unknown {
    return require(path.resolve(__dirname, `../../${name}`));
}
