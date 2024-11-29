import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import { defineConfig } from 'rollup';

const config = defineConfig({
    input: 'src/main.ts',
    output: {
        sourcemap: true,
        file: `${process.env.NODE_ENV === 'production' ? 'dist' : 'out'}/main.nodejs.js`,
        format: 'cjs',
    },

    plugins: [
        typescript({
            target: 'es2021',
            compilerOptions: {
                moduleResolution: 'Node16',
                module: "Node16",
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
