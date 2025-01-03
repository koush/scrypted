const https = require('https');
const axios = require('axios').create({
    httpsAgent: new https.Agent({
        rejectUnauthorized: false
    })
});
const process = require('process');
const path = require('path');
const fs = require('fs');

function getUserHome() {
    const ret = process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'];
    if (!ret)
        throw new Error('Neither USERPROFILE or HOME are defined.');
    return ret;
}

const scryptedHome = path.join(getUserHome(), '.scrypted');
const loginPath = path.join(scryptedHome, 'login.json');

function getLogin(ip) {
    let login;
    try {
        login = JSON.parse(fs.readFileSync(loginPath).toString());
    }
    catch (e) {
        login = {};
    }

    login = login[ip];

    const ret = {
        username: login.username,
        password: login.token,
    };

    return ret;
}

function showLoginError() {
    console.error('Authorization required. Please log in with the following:');
    console.error('     npx scrypted login [ip]');
}

function toIpAndPort(ip) {
    if (ip.indexOf(':') === -1)
        ip += ':10443'
    console.log(ip);
    return ip;
}

exports.deploy = function (debugHost, noRebind) {
    debugHost = toIpAndPort(debugHost);

    return new Promise((resolve, reject) => {
        var out;
        if (process.env.NODE_ENV === 'production')
            out = path.resolve(process.cwd(), 'dist');
        else
            out = path.resolve(process.cwd(), 'out');

        const outFilename = 'plugin.zip';
        const main = path.resolve(out, outFilename);
        if (!fs.existsSync(main)) {
            console.error('npm run scrypted-webpack to build a webpack bundle for Scrypted.')
            reject(new Error(`Missing webpack bundle: ${main}`));
            return 3;
        }

        var packageJson = path.resolve(process.cwd(), 'package.json');
        packageJson = JSON.parse(fs.readFileSync(packageJson));
        const npmPackage = packageJson.name || '';

        var rebindQuery = noRebind ? 'no-rebind' : '';

        const deployUrl = `https://${debugHost}/web/component/script/deploy?${rebindQuery}&npmPackage=${npmPackage}`
        const setupUrl = `https://${debugHost}/web/component/script/setup?${rebindQuery}&npmPackage=${npmPackage}`

        const fileContents = fs.readFileSync(main);
        console.log(`deploying to ${debugHost}`);

        let auth;
        try {
            auth = getLogin(debugHost);
        }
        catch (e) {
            console.error(e);
            showLoginError();
            process.exit(1);
        }

        axios.post(setupUrl, packageJson,
            {
                auth,
                timeout: 10000,
                maxRedirects: 0,
                validateStatus: function (status) {
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
                        validateStatus: function (status) {
                            return status >= 200 && status < 300;
                        },
                        headers: {
                            "Content-Type": "application/zip "
                        }
                    }
                )
            })
            .then(() => {
                console.log(`deployed to ${debugHost}`);
                resolve();
            })
            .catch((err) => {
                console.error(err.message);
                if (err.response && err.response.data) {
                    console.log('\x1b[31m%s\x1b[0m', err.response.data);
                }
                reject(err);
            });
    });
}

exports.debug = function (debugHost, entryPoint) {
    debugHost = toIpAndPort(debugHost);

    return new Promise((resolve, reject) => {
        var packageJson = path.resolve(process.cwd(), 'package.json');
        packageJson = JSON.parse(fs.readFileSync(packageJson));
        const npmPackage = packageJson.name || '';

        const debugUrl = `https://${debugHost}/web/component/script/debug?npmPackage=${npmPackage}`
        console.log(`initiating debugger on ${debugHost}`);

        axios.post(debugUrl, undefined, {
            auth: getLogin(debugHost),
            timeout: 10000,
            maxRedirects: 0,
            validateStatus: function (status) {
                return status >= 200 && status < 300; // default
            },
        })
            .then(response => {
                console.log(`debugger ready on ${debugHost}`);
                resolve();
            })
            .catch((err) => {
                console.error(err.message);
                if (err.response && err.response.data) {
                    console.log('\x1b[31m%s\x1b[0m', err.response.data);
                }
                reject(err);
            });
    })
}

exports.getDefaultWebpackConfig = function (name) {
    return require(path.resolve(__dirname, `../${name}`));
}
