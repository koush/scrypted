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

var entry;
for (var search of ['src/main.js', 'src/main.ts']) {
    var resolved = path.resolve(cwd, search);
    if (fs.existsSync(resolved)) {
        entry = resolved;
        break;
    }
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
    console.error('unable to locate src/main.js or src/main.ts');
    return 1;
}

var webpackCmd = path.resolve(cwd, 'node_modules/.bin/webpack-cli');
if (!fs.existsSync(webpackCmd)) {
    webpackCmd = path.resolve(cwd, 'node_modules/@scrypted/sdk/node_modules/.bin/webpack-cli')
}
if (os.platform().startsWith('win')) {
    webpackCmd += '.cmd';
}
var zip = new AdmZip();

const NODE_PATH = path.resolve(__dirname, '..', 'node_modules');

process.chdir(__dirname);

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
            config.entry = {
                main: entry,
            };
            config.output.path = out;
            config.output.filename = runtime.output;
            
            webpack(config, (err, stats) => {
                if (err)
                    return reject(err);

                // create a zip that has a main.js in the root, and an fs folder containing a read only virtual file system.
                // todo: read write file system? seems like a potential sandbox and backup nightmare to do a real fs. scripts should
                // use localStorage, etc?
                zip.addLocalFile(path.join(out, runtime.output));
                console.log(runtime.output);
                resolve();
            })

            // var child = spawn('webpack-cli', [
            //     // "--json",
            //     '--config',
            //     webpackConfig,
            //     '--output-path',
            //     out,
            //     '--output-filename',
            //     runtime.output,
            //     '--entry',
            //     "main=" + entry,
            // ], {
            //     env: Object.assign({},process.env, {
            //         NODE_PATH,
            //         SCRYPTED_DEFAULT_WEBPACK_CONFIG: defaultWebpackConfig,
            //     }),
            // });

            // child.stdout.on('data', function (data) {
            //     process.stdout.write(data);
            // });

            // child.stderr.on('data', function (data) {
            //     process.stdout.write(data);
            // });

            // child.on('exit', function (data) {
            //     if (data)
            //         return reject(new Error('webpack failed: ' + data));

            //     // create a zip that has a main.js in the root, and an fs folder containing a read only virtual file system.
            //     // todo: read write file system? seems like a potential sandbox and backup nightmare to do a real fs. scripts should
            //     // use localStorage, etc?
            //     zip.addLocalFile(path.join(out, runtime.output));
            //     console.log(runtime.output);
            //     resolve();
            // });

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