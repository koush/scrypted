const path = require('path');
const webpack = require('webpack');
const TerserPlugin = require("terser-webpack-plugin");
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');
const fs = require('fs');

let out;
const cwd = process.cwd();

const isProduction = process.env.NODE_ENV === 'production';
if (isProduction) {
    out = path.resolve(cwd, 'dist');
}
else {
    out = path.resolve(cwd, 'out');
}


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

const plugins = [
    new webpack.DefinePlugin({
        'import.meta': undefined,
    }),
    new webpack.DefinePlugin({
        'process.env.SSDP_COV': false,
    }),
    new webpack.optimize.LimitChunkCountPlugin({
        maxChunks: 1,
    }),
    new webpack.BannerPlugin({
        banner: (data) => {
            return `\n//# sourceURL=/plugin/${path.basename(data.filename)}`;
        },
        raw: true,
        footer: true,
    }),
];

if (process.env.WEBPACK_ANALYZER) {
    plugins.push(
        new BundleAnalyzerPlugin({
            generateStatsFile: true,
        }),
    );
}

const alias = {};
const polyfills = [
    '@scrypted/node-pty',
    'node-forge',
    'sharp',
    'source-map-support/register',
    'adm-zip',
    "memfs",
    "realfs",
    "fakefs",
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
            // {
            //     test: /\.(js)x?$/,
            //     loader: 'babel-loader',
            // },
            process.env.SCRYPTED_WEBPACK_BABEL ?
                {
                    test: /\.(ts|js)x?$/,
                    exclude: /(core-js)/,
                    use: {
                        loader: 'babel-loader',
                        options: {
                            "presets": [
                                "@babel/preset-typescript",
                            ]
                        }
                    }
                } :
                {
                    test: /\.([cm]?ts|tsx)$/,
                    loader: "ts-loader",
                },
        ],
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

    plugins,

    optimization: {
        minimize: isProduction,
        minimizer: [
            new TerserPlugin(
                {
                    terserOptions: {
                        compress: {
                            typeofs: false,
                        }
                    }
                },
            ),
        ],
    },

    devtool: process.env.WEBPACK_DEVTOOL || 'source-map',
};
