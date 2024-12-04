import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import virtual from '@rollup/plugin-virtual';
import { defineConfig } from 'rollup';
import fs from 'fs';
import path from 'path';

// replace createRequire to force rollup.
function replaceCreateRequire() {
    return {
        name: 'replace-create-require',
        transform(code, id) {
            const packageRequireRegex = /const\s+.*?\s*=\s*createRequire.*?;/;
            if (packageRequireRegex.test(code)) {
                return {
                    code: code.replace(
                        packageRequireRegex,
                        '',
                    ),
                    map: null,
                };
            }
            return null;
        }
    };
}

const cwd = process.cwd();
const packageJson = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json').toString()));
const external = Object.keys(packageJson.optionalDependencies || {});
const tsconfig = JSON.parse(fs.readFileSync(path.join(cwd, 'tsconfig.json').toString()));


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
    if (fs.existsSync('./src/main.ts')) {
        entries.push({
            filename: './src/main.ts',
            output: defaultMainNodeJs,
        });
    }
}

if (!entries?.length)
    throw new Error('unable to locate src/main.ts');

const config = defineConfig(
    entries.map(entry => ({
        input: `${entry.filename.slice(0, -3)}.nodejs.ts`,
        output: {
            strict: false,
            sourcemap: true,
            preserveModules: false,

            inlineDynamicImports:true,
            file: `${process.env.NODE_ENV === 'production' ? 'dist' : 'out'}/${entry.output}`,
            // dir: `${process.env.NODE_ENV === 'production' ? 'dist' : 'out'}`,

            format: packageJson.type === 'module' ? 'esm' : 'commonjs',
            // necessary for es module since it is loaded from a file.
            // no harm having this for commonjs since this is the same path server uses.
            banner: (entry) => {
                return `//# sourceURL=/plugin/${entry.name}.js
                `
            },
        },
        external,

        plugins: [
            replaceCreateRequire(),
            // use this to inject sdk init.
            virtual({
                [`${entry.filename.slice(0, -3)}.nodejs.ts`]:
                    `
                    export * from '${entry.filename}';
                    ` +
                    (!entry.filename.endsWith('main.ts')
                        ? ''

                        : `
                    export { default } from '${entry.filename}';
                    `)
            }),

            typescript(tsconfig),
            commonjs({
                // need ts extension so require calls in ts get resolved.
                extensions: ['.js', '.ts'],
                transformMixedEsModules: true,
                ignoreDynamicRequires: true,
            }),
            resolve({
                extensions: ['.js', '.ts'],
                browser: false,
                preferBuiltins: true,
            }),
            json(),
        ]
    })),
);

export default config;
