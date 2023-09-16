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
const spawn = require('child_process').spawn;
const cwd = process.cwd();
const AdmZip = require('adm-zip');
const os = require('os');
const rimraf = require('rimraf');
const webpack = require('webpack');
const esbuild = require('esbuild');
const ncp = require('ncp');
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
else if (false) {
    const packageJson = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json').toString()));
    const optionalDependencies = Object.keys(packageJson.optionalDependencies || {});

    let out;
    if (process.env.NODE_ENV == 'production')
        out = path.resolve(cwd, 'dist');
    else
        out = path.resolve(cwd, 'out');

    let outfile = path.join(out, 'main.nodejs.js');

    esbuild.build({
        entryPoints: ['src/main.ts'],
        bundle: true,
        outfile,
        platform: 'node',
        format: 'cjs',
        // loader: { '.json': 'file' },
        external: [
            ...Object.keys(optionalDependencies),
        ],
        sourcemap: true,
    })
        .then(() => {
            const zip = new AdmZip();

            const readme = path.join(cwd, 'README.md');
            if (fs.existsSync(readme)) {
                zip.addLocalFile(readme);
            }

            zip.addLocalFile(outfile);
            zip.addLocalFile(outfile + '.map');

            const zipfs = path.join(cwd, 'fs');
            if (fs.existsSync(zipfs))
                zip.addLocalFolder(zipfs, 'fs');
            zip.writeZip(path.join(out, 'plugin.zip'));
        })
        .catch(e => process.nextTick(() => {
            console.error(e);
            throw new Error(e);
        }));
}
else {
    var entry;
    for (var search of ['src/main.js', 'src/main.ts']) {
        var resolved = path.resolve(cwd, search);
        if (fs.existsSync(resolved)) {
            entry = resolved;
            break;
        }
    }

    const packageJson = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json').toString()));
    const optionalDependencies = Object.keys(packageJson.optionalDependencies || {});

    if (packageJson.scrypted.babel) {
        process.env.SCRYPTED_WEBPACK_BABEL = 'true';
    }

    const runtimes = [
        // {
        //     config: 'webpack.duktape.config.js',
        //     output: 'main.js',
        // },
        // {
        //     config: 'webpack.quickjs.config.js',
        //     output: 'main.quickjs.js',
        // },
        {
            config: 'webpack.nodejs.config.js',
            output: 'main.nodejs.js',
        },
    ];

    var out;
    if (process.env.NODE_ENV == 'production')
        out = path.resolve(cwd, 'dist');
    else
        out = path.resolve(cwd, 'out');

    if (!entry) {
        console.warn('unable to locate src/main.js or src/main.ts');
        console.warn('if a custom webpack config is used, will fall back to an entry configured there');
    }

    var webpackCmd = path.resolve(cwd, 'node_modules/.bin/webpack-cli');
    if (!fs.existsSync(webpackCmd)) {
        webpackCmd = path.resolve(cwd, 'node_modules/@scrypted/sdk/node_modules/.bin/webpack-cli')
    }
    if (os.platform().startsWith('win')) {
        webpackCmd += '.cmd';
    }
    var zip = new AdmZip();

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

        for (const runtime of runtimes) {
            await new Promise((resolve, reject) => {
                var webpackConfig;
                var customWebpackConfig = path.resolve(cwd, runtime.config);
                const defaultWebpackConfig = path.resolve(__dirname, '..', runtime.config);
                if (fs.existsSync(customWebpackConfig)) {
                    webpackConfig = customWebpackConfig;
                }
                else {
                    webpackConfig = defaultWebpackConfig;
                }

                process.env.SCRYPTED_DEFAULT_WEBPACK_CONFIG = defaultWebpackConfig;

                const config = require(webpackConfig);
                if (entry) {
                    // a standard entrypoint was found
                    config.entry = {
                        main: entry,
                    };
                } else {
                    // try to use an entrypoint specified in the webpack config
                    if (!config?.entry?.main) {
                        console.error("webpack config does not supply an entry file");
                        return 1;
                    }
                    var resolved = path.resolve(cwd, config.entry.main);
                    if (fs.existsSync(resolved)) {
                        config.entry.main = resolved
                    } else {
                        console.error("entry file specified in webpack config does not exist");
                        return 1;
                    }
                }
                config.output.path = out;
                config.output.filename = runtime.output;


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
                    zip.addLocalFile(path.join(out, runtime.output));
                    const sourcemap = path.join(out, runtime.output + '.map');
                    if (fs.existsSync(sourcemap))
                        zip.addLocalFile(sourcemap);
                    console.log(runtime.output);
                    resolve();
                })
            });
        }

        var zipfs = path.join(cwd, 'fs');
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