import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import virtual from '@rollup/plugin-virtual';
import { defineConfig } from 'rollup';

const config = defineConfig({
    input: 'src/entry.ts',
    output: {
        sourcemap: true,
        file: `${process.env.NODE_ENV === 'production' ? 'dist' : 'out'}/main.nodejs.js`,
        format: 'module',
        banner: `//# sourceURL=/plugin/main.nodejs.js`,
    },
    external: [
        'unifi-protect',
    ],

    plugins: [
        virtual({
            'src/entry.ts':
                `
                    export * from './src/main.ts';
                    export { default } from './src/main.ts';
            `,
        }),
        typescript({
            target: 'es2021',
            compilerOptions: {
                moduleResolution: 'Node16',
                module: "esnext",
                strict: true,
                sourceMap: true,
                resolveJsonModule: true,
                esModuleInterop: true,
                allowSyntheticDefaultImports: true,
            },
        }),
        commonjs({
            // need ts extension so require calls in ts get resolved.
            extensions: ['.js', '.ts'],
            transformMixedEsModules: true,
        }),
        resolve({
            browser: true,
            preferBuiltins: false,
        }),
        json(),
    ]
});

export default config;
