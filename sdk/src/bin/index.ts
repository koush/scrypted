import { httpFetch } from '@scrypted/auth-fetch';
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

export async function deploy(debugHost: string, noRebind?: boolean): Promise<void> {
    debugHost = toIpAndPort(debugHost);

    let out: string;
    if (process.env.NODE_ENV === 'production')
        out = path.resolve(process.cwd(), 'dist');
    else
        out = path.resolve(process.cwd(), 'out');

    const outFilename = 'plugin.zip';
    const main = path.resolve(out, outFilename);
    if (!fs.existsSync(main)) {
        console.error('npm run scrypted-webpack to build a webpack bundle for Scrypted.');
        throw new Error(`Missing webpack bundle: ${main}`);
    }

    const packageJsonPath = path.resolve(process.cwd(), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath).toString());
    const npmPackage = packageJson.name || '';

    const rebindQuery = noRebind ? 'no-rebind' : '';

    const deployUrl = `https://${debugHost}/web/component/script/deploy?${rebindQuery}&npmPackage=${npmPackage}`;
    const setupUrl = `https://${debugHost}/web/component/script/setup?${rebindQuery}&npmPackage=${npmPackage}`;

    const fileContents = fs.readFileSync(main);
    console.log(`deploying to ${debugHost}`);

    const auth = getLogin(debugHost);

    try {
        await httpFetch({
            url: setupUrl,
            method: 'POST',
            body: JSON.stringify(packageJson),
            headers: {
                ...basicAuthHeaders(auth.username, auth.password),
                'Content-Type': 'application/json',
            },
            timeout: 10000,
            rejectUnauthorized: false,
            checkStatusCode(statusCode) {
                if (statusCode === 401) {
                    showLoginError();
                }
                return statusCode >= 200 && statusCode < 300;
            },
        });

        console.log(`configured ${debugHost}`);

        await httpFetch({
            url: deployUrl,
            method: 'POST',
            body: fileContents,
            timeout: 10000,
            rejectUnauthorized: false,
            headers: {
                ...basicAuthHeaders(auth.username, auth.password),
                'Content-Type': 'application/zip',
            },
        });

        console.log(`deployed to ${debugHost}`);
    }
    catch (err) {
        const error = err as Error;
        console.error(error.message);
        throw error;
    }
}

function basicAuthHeaders(username: string, password: string) {
    return {
        'Authorization': `Basic ${Buffer.from(username + ":" + password).toString('base64')}`
    };
}

export async function debug(debugHost: string, entryPoint?: string): Promise<void> {
    debugHost = toIpAndPort(debugHost);

    const packageJsonPath = path.resolve(process.cwd(), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath).toString());
    const npmPackage = packageJson.name || '';

    const debugUrl = `https://${debugHost}/web/component/script/debug?npmPackage=${npmPackage}`;
    console.log(`initiating debugger on ${debugHost}`);

    const auth = getLogin(debugHost);

    try {
        await httpFetch({
            url: debugUrl,
            method: 'POST',
            headers: basicAuthHeaders(auth.username, auth.password),
            timeout: 10000,
            rejectUnauthorized: false,
        });

        console.log(`debugger ready on ${debugHost}`);
    }
    catch (err) {
        const error = err as Error;
        console.error(error.message);
        throw error;
    }
}

export function getDefaultWebpackConfig(name: string): unknown {
    return require(path.resolve(__dirname, `../../../${name}`));
}
