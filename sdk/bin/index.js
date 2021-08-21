const https = require('https');
const axios = require('axios').create({
    httpsAgent: new https.Agent({
        rejectUnauthorized: false
    })
});
const process = require('process');
const path = require('path');
const fs = require('fs');
const chalk = require('chalk');

exports.deploy = function (debugHost, noRebind) {
    return new Promise((resolve, reject) => {
        var out;
        if (process.env.NODE_ENV == 'production')
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

        const deployUrl = `https://${debugHost}:9443/web/component/script/deploy?${rebindQuery}&npmPackage=${npmPackage}`
        const setupUrl = `https://${debugHost}:9443/web/component/script/setup?${rebindQuery}&npmPackage=${npmPackage}`

        const fileContents = fs.readFileSync(main);
        console.log(`deploying to ${debugHost}`);

        axios.post(setupUrl, packageJson,
            {
                timeout: 10000,
                maxRedirects: 0,
                validateStatus: function (status) {
                    return status >= 200 && status < 300;
                },
            })
            .then(() => {
                console.log(`configured ${debugHost}`);

                return axios.post(deployUrl, fileContents,
                    {
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
                    console.log(chalk.red(err.response.data));
                }
                reject(err);
            });
    });
}

exports.debug = function (debugHost, entryPoint) {
    return new Promise((resolve, reject) => {
        const outFilename = entryPoint || 'main.nodejs.js';
        var packageJson = path.resolve(process.cwd(), 'package.json');
        packageJson = JSON.parse(fs.readFileSync(packageJson));
        const npmPackage = packageJson.name || '';

        const debugUrl = `https://${debugHost}:9443/web/component/script/debug?filename=${outFilename}&npmPackage=${npmPackage}`
        console.log(`initiating debugger on ${debugHost}`);

        axios.post(debugUrl, {
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
                    console.log(chalk.red(err.response.data));
                }
                reject(err);
            });
    })
}

exports.getDefaultWebpackConfig = function (name) {
    return require(path.resolve(__dirname, `../${name}`));
}
