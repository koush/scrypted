#! /usr/bin/env node
try {
    require('adm-zip');
}
catch (e) {
    throw new Error('Please "npm install" in the "sdk" directory.');

}
const path = require('path');
const process = require('process');
const fs = require('fs');
const cwd = process.cwd();
const AdmZip = require('adm-zip');
const os = require('os');
const rimraf = require('rimraf');
const webpack = require('webpack');
const tmp = require('tmp');

if (fs.existsSync(path.resolve(cwd, 'src/main.py'))) {
    let out;
    if (process.env.NODE_ENV == 'production')
        out = path.resolve(cwd, 'dist');
    else
        out = path.resolve(cwd, 'out');

    const resolved = path.resolve(cwd, 'src');

    const zip = new AdmZip();
    const readme = path.join(cwd, 'README.md');
    if (fs.existsSync(readme)) {
        zip.addLocalFile(readme);
    }

    zip.addLocalFolder(resolved);

    const sdk = path.join(__dirname, '../types/scrypted_python/scrypted_sdk');
    zip.addLocalFolder(sdk, 'scrypted_sdk', filename => !filename.endsWith('.pyc'));

    const zipfs = path.join(cwd, 'fs');
    if (fs.existsSync(zipfs))
        zip.addLocalFolder(zipfs, 'fs');
    zip.writeZip(path.join(out, 'plugin.zip'));
}
else {
    const packageJson = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json').toString()));
    const optionalDependencies = Object.keys(packageJson.optionalDependencies || {});

    if (packageJson.scrypted.babel) {
        process.env.SCRYPTED_WEBPACK_BABEL = 'true';
    }

    const defaultMainNodeJs = 'main.nodejs.js';
    const entries = [];
    if (packageJson.exports) {
        for (const [key, value] of Object.entries(packageJson.exports)) {
            entries.push({
                filename: key,
                output: value,
            });
        }
    }
    else {
        for (const search of ['src/main.js', 'src/main.ts']) {
            const resolved = path.resolve(cwd, search);
            if (fs.existsSync(resolved)) {
                entries.push({
                    filename: search,
                    output: defaultMainNodeJs,
                });
                break;
            }
        }
    }

    const nodeWebpackConfig = 'webpack.nodejs.config.js';

    let out;
    if (process.env.NODE_ENV == 'production')
        out = path.resolve(cwd, 'dist');
    else
        out = path.resolve(cwd, 'out');

    if (!entries?.length) {
        console.warn('unable to locate src/main.js or src/main.ts');
        console.warn('if a custom webpack config is used, will fall back to an entry configured there');
        entries.push(undefined);
    }

    let webpackCmd = path.resolve(cwd, 'node_modules/.bin/webpack-cli');
    if (!fs.existsSync(webpackCmd)) {
        webpackCmd = path.resolve(cwd, 'node_modules/@scrypted/sdk/node_modules/.bin/webpack-cli')
    }
    if (os.platform().startsWith('win')) {
        webpackCmd += '.cmd';
    }
    const zip = new AdmZip();

    const readme = path.join(cwd, 'README.md');
    if (fs.existsSync(readme)) {
        let readmeText = fs.readFileSync(readme).toString();;
        const changelog = path.join(cwd, 'CHANGELOG.md');
        if (fs.existsSync(changelog)) {
            readmeText += '\n\n\n<br/><br/>' + fs.readFileSync(changelog).toString();
        }
        zip.addFile('README.md', Buffer.from(readmeText));
    }

    const NODE_PATH = path.resolve(__dirname, '..', 'node_modules');

    // hack to override NODE_PATH dynamically.
    // otherwise webpack plugins are not found.
    process.env.NODE_PATH = NODE_PATH;
    require('module').Module._initPaths();

    async function pack() {
        if (out)
            rimraf.sync(out);

        const promises = [];
        for (let entry of entries) {
            const promise = new Promise((resolve, reject) => {
                let webpackConfig;
                const customWebpackConfig = path.resolve(cwd, nodeWebpackConfig);
                const defaultWebpackConfig = path.resolve(__dirname, '..', nodeWebpackConfig);
                if (fs.existsSync(customWebpackConfig)) {
                    webpackConfig = customWebpackConfig;
                }
                else {
                    webpackConfig = defaultWebpackConfig;
                }

                process.env.SCRYPTED_DEFAULT_WEBPACK_CONFIG = defaultWebpackConfig;

                const config = require(webpackConfig);
                entry ||= {
                    filename: config?.entry?.main,
                    output: defaultMainNodeJs,
                };

                if (!entry?.filename) {
                    console.error("no main.ts or main.js was found, and webpack config does not supply an entry file.");
                    console.error(entry?.filename);
                    return 1;
                }

                const main = path.resolve(cwd, entry.filename);
                if (!fs.existsSync(main)) {
                    console.error("entry file specified in webpack config does not exist");
                    return 1;
                }

                config.entry = {
                    main,
                };
                config.output.path = out;
                config.output.filename = entry?.output || defaultMainNodeJs;

                for (const opt of optionalDependencies) {
                    const t = tmp.tmpNameSync({
                        postfix: '.js',
                    });
                    fs.writeFileSync(t, `
                        const e = __non_webpack_require__('${opt}');
                        module.exports = e;
                    `);
                    config.resolve.alias[opt] = t;
                }

                webpack(config, (err, stats) => {
                    if (err)
                        return reject(err);

                    if (stats.hasErrors()) {
                        console.error(stats.toJson().errors);
                        return reject(new Error('webpack failed'));
                    }

                    // create a zip that has a main.js in the root, and an fs folder containing a read only virtual file system.
                    // todo: read write file system? seems like a potential sandbox and backup nightmare to do a real fs. scripts should
                    // use localStorage, etc?
                    const jsFiles = fs.readdirSync(out, {
                        withFileTypes: true
                    }).filter(ft => ft.isFile() && ft.name.endsWith('.js')).map(ft => ft.name);
                    for (const js of jsFiles) {
                        zip.addLocalFile(path.join(out, js));
                        const sourcemap = path.join(out, js + '.map');
                        if (fs.existsSync(sourcemap))
                            zip.addLocalFile(sourcemap);
                        console.log(js);
                    }
                    resolve();
                })
            });
            promises.push(promise);
        }

        await Promise.all(promises);

        const zipfs = path.join(cwd, 'fs');
        if (fs.existsSync(zipfs))
            zip.addLocalFolder(zipfs, 'fs');
        zip.writeZip(path.join(out, 'plugin.zip'));
    }

    pack()
        .catch(e => process.nextTick(() => {
            console.error(e);
            throw new Error(e);
        }));

}