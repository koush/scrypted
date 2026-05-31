#! /usr/bin/env node
try {
    require('adm-zip');
}
catch {
    throw new Error('Please "npm install" in the "sdk" directory.');
}

import path from 'path';
import process from 'process';
import fs from 'fs';
import os from 'os';
import AdmZip from 'adm-zip';
import { rimrafSync } from 'rimraf';
import webpack from 'webpack';
import tmp from 'tmp';
import child_process from 'child_process';
import { once } from 'events';

const cwd = process.cwd();

let out: string;
if (process.env.NODE_ENV === 'production')
    out = path.resolve(cwd, 'dist');
else
    out = path.resolve(cwd, 'out');

if (fs.existsSync(path.resolve(cwd, 'src/main.py'))) {
    const resolved = path.resolve(cwd, 'src');

    const zip = new AdmZip();
    const readme = path.join(cwd, 'README.md');
    if (fs.existsSync(readme)) {
        zip.addLocalFile(readme);
    }

    zip.addLocalFolder(resolved);

    const sdk = path.join(__dirname, '../../../types/scrypted_python/scrypted_sdk');
    zip.addLocalFolder(sdk, 'scrypted_sdk', filename => !filename.endsWith('.pyc'));

    const zipfs = path.join(cwd, 'fs');
    if (fs.existsSync(zipfs))
        zip.addLocalFolder(zipfs, 'fs');
    zip.writeZip(path.join(out, 'plugin.zip'));
    process.exit(0);
}

interface PackageJson {
    name?: string;
    exports?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    scrypted?: {
        babel?: boolean;
        rollup?: boolean;
        interfaceDescriptors?: unknown;
    };
    type?: string;
}

const packageJson: PackageJson = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
const interfaceDescriptors = packageJson.scrypted?.interfaceDescriptors;

const optionalDependencies = Object.keys(packageJson.optionalDependencies || {});

if (packageJson.scrypted?.babel) {
    process.env.SCRYPTED_WEBPACK_BABEL = 'true';
}

const defaultMainNodeJs = 'main.nodejs.js';
interface Entry {
    filename: string;
    output: string;
}
const entries: (Entry | undefined)[] = [];

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

if (!entries?.length) {
    console.warn('unable to locate src/main.js or src/main.ts');
    console.warn('if a custom webpack config is used, will fall back to an entry configured there');
    entries.push(undefined);
}

const zip = new AdmZip();

const readme = path.join(cwd, 'README.md');
if (fs.existsSync(readme)) {
    let readmeText = fs.readFileSync(readme).toString();
    const changelog = path.join(cwd, 'CHANGELOG.md');
    if (fs.existsSync(changelog)) {
        readmeText += '\n\n\n<br/><br/>' + fs.readFileSync(changelog).toString();
    }
    zip.addFile('README.md', Buffer.from(readmeText));
}

const NODE_PATH = path.resolve(__dirname, '..', '..', '..', 'node_modules');

process.env.NODE_PATH = NODE_PATH;
require('module').Module._initPaths();

interface WebpackConfig {
    entry?: Record<string, string> | string;
    output?: {
        filename?: string;
        path?: string;
    };
    resolve?: {
        alias?: Record<string, string>;
    };
}

async function rollup(): Promise<void> {
    if (out)
        rimrafSync(out);

    let rollupCmd = path.resolve(cwd, 'node_modules/.bin/rollup');

    if (!fs.existsSync(rollupCmd)) {
        rollupCmd = path.resolve(cwd, 'node_modules/@scrypted/sdk/node_modules/.bin/rollup');
    }
    if (os.platform().startsWith('win')) {
        rollupCmd += '.cmd';
    }

    const cp = child_process.spawn(rollupCmd, [
        '--config', path.resolve(__dirname, '../../../rollup.nodejs.config.mjs'),
    ], {
        stdio: 'inherit',
    });

    await once(cp, 'exit');
    if (cp.exitCode)
        throw new Error('rollup failed');

    finishZip();
}

function finishZip(): void {
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

    const sdkPackageJson = require(path.join(__dirname, '../../../package.json'));
    zip.addFile('sdk.json', Buffer.from(JSON.stringify({
        version: (sdkPackageJson as { version: string }).version,
        interfaceDescriptors,
    })));

    if (packageJson.type === 'module') {
        zip.addFile('package.json', Buffer.from(JSON.stringify({
            type: 'module'
        })));
    }

    const zipfs = path.join(cwd, 'fs');
    if (fs.existsSync(zipfs))
        zip.addLocalFolder(zipfs, 'fs');
    zip.writeZip(path.join(out, 'plugin.zip'));
}

async function pack(): Promise<void> {
    if (out)
        rimrafSync(out);

    await new Promise<void>((resolve, reject) => {
        let webpackConfig: string;
        const customWebpackConfig = path.resolve(cwd, nodeWebpackConfig);
        const defaultWebpackConfig = path.resolve(__dirname, '..', '..', '..', nodeWebpackConfig);
        if (fs.existsSync(customWebpackConfig)) {
            webpackConfig = customWebpackConfig;
        }
        else {
            webpackConfig = defaultWebpackConfig;
        }

        process.env.SCRYPTED_DEFAULT_WEBPACK_CONFIG = defaultWebpackConfig;

        const webpackEntries: Record<string, string> = {};
        const config: WebpackConfig = require(webpackConfig);
        for (const entry of entries) {
            const normalizedEntry = entry || {
                filename: (typeof config?.entry === 'object' ? config.entry?.main : config.entry) || '',
                output: defaultMainNodeJs,
            };

            if (!normalizedEntry?.filename) {
                console.error("no main.ts or main.js was found, and webpack config does not supply an entry file.");
                console.error(normalizedEntry?.filename);
                throw new Error();
            }

            const main = path.resolve(cwd, normalizedEntry.filename);
            if (!fs.existsSync(main)) {
                console.error("entry file specified in webpack config does not exist");
                throw new Error();
            }

            webpackEntries[normalizedEntry.output] = main;
        }

        config.entry = webpackEntries;
        config.output = config.output || {};
        config.output.filename = '[name]';
        config.output.path = out;
        
        config.resolve = config.resolve || {};
        config.resolve.alias = config.resolve.alias || {};
        
        for (const opt of optionalDependencies) {
            const t = tmp.tmpNameSync({
                postfix: '.js',
            });
            fs.writeFileSync(t, `
                        const e = __non_webpack_require__('${opt}');
                        module.exports = e;
                    `);
            config.resolve.alias![opt] = t;
        }

        webpack(config as webpack.Configuration, (err, stats) => {
            if (err)
                return reject(err);

            if (stats?.hasErrors()) {
                console.error(stats.toJson()?.errors);
                return reject(new Error('webpack failed'));
            }

            resolve();
        });
    });

    finishZip();
}

(packageJson.scrypted?.rollup ? rollup : pack)()
    .catch(e => process.nextTick(() => {
        console.error(e);
        throw new Error(e);
    }));
