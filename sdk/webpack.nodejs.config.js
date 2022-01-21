const path = require('path');
const webpack = require('webpack');
const TerserPlugin = require("terser-webpack-plugin");
// const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');
const fs = require('fs');

let out;
const cwd = process.cwd();

if (process.env.NODE_ENV == 'production') {
    out = path.resolve(cwd, 'dist');
}
else {
    out = path.resolve(cwd, 'out');
}

const isProduction = process.env.NODE_ENV == 'production';

function ensureAlias(name) {
    const sanitizedName = name.replace(/@/g, '').replace(/\//g, '').replace(/-/g, '');
    const sanitizedPath = path.join(__dirname, 'polyfill', sanitizedName + '.js');
    const contents = `const ${sanitizedName} = __non_webpack_require__('${name}'); module.exports = ${sanitizedName};`
    try {
        if (fs.readFileSync(sanitizedPath).toString() !== contents)
            throw new Error();
    }
    catch (e) {
        fs.writeFileSync(sanitizedPath, contents);
    }
    return sanitizedPath;
}

const alias = {};
const polyfills = [
    'adm-zip',
    "memfs",
    "realfs",
    "fakefs",
    // remove this at some point
    // 1/21/2022
    'wrtc',
    '@koush/wrtc',
    "mdns",
    "typescript",
];

for (const p of polyfills) {
    alias[p] = ensureAlias(p);
}

module.exports = {
    mode: process.env.NODE_ENV || 'development',
    output: {
        devtoolModuleFilenameTemplate: function (info) {
            return path.relative(out, info.absoluteResourcePath);
        },

        // export everything to a var "window" which will be an alias for "exports" in Scrypted
        library: {
            name: 'exports',
            type: 'assign-properties',
        },
    },
    module: {
        rules: [
            {
                test: /\.(ts|js)x?$/,
                // unsure if this is correct... need to transpile node modules at times.
                // exclude: /(core-js|node_modules|bower_components)/,
                exclude: /(core-js)/,
                use: {
                    loader: 'babel-loader',
                    options: {
                        "plugins": [
                            "@babel/plugin-transform-modules-commonjs",
                            "babel-plugin-const-enum",
                            "@babel/plugin-transform-typescript",
                            "@babel/plugin-proposal-class-properties",
                            "@babel/plugin-proposal-optional-chaining",
                            "@babel/plugin-proposal-nullish-coalescing-operator",
                            "@babel/plugin-proposal-numeric-separator",
                        ],
                        "presets": [
                            "@babel/preset-typescript",
                        ]
                    }
                }
            },

            // {
            //     test: /\.tsx?$/,
            //     loader: 'ts-loader',
            //     exclude: /node_modules/,
            //     options: {
            //         configFile : path.join(__dirname, 'tsconfig.plugin.json'),
            //     },
            // }
        ]
    },

    node: {
        __dirname: true,
    },
    target: "node",

    resolveLoader: {
        modules: module.paths,

    },
    resolve: {
        alias,
        extensions: ['.tsx', '.ts', '.js']
    },

    stats: {
        colors: true
    },

    plugins: [
        new webpack.DefinePlugin({
            'process.env.SSDP_COV': false,
        }),
        // new BundleAnalyzerPlugin({
        //     generateStatsFile: true
        // }),
    ],

    optimization: {
        minimize: isProduction,
        minimizer: [
            new TerserPlugin({
                terserOptions: {
                    keep_classnames: true,
                }
            }),
        ],
    },

    devtool: 'source-map',
};
