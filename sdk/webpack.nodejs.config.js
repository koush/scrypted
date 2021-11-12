const path = require('path');
const webpack = require('webpack');
const TerserPlugin = require("terser-webpack-plugin");

var out;
const cwd = process.cwd();

if (process.env.NODE_ENV == 'production') {
    out = path.resolve(cwd, 'dist');
}
else {
    out = path.resolve(cwd, 'out');
}

const isProduction = process.env.NODE_ENV == 'production';

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

        alias: {
            "realfs": path.resolve(__dirname, 'polyfill/realfs'),
            wrtc: path.resolve(__dirname, 'polyfill/wrtc'),
            '@koush/wrtc': path.resolve(__dirname, 'polyfill/koush-wrtc'),
            mdns: path.resolve(__dirname, 'polyfill/mdns'),
            typescript: path.resolve(__dirname, 'polyfill/typescript'),
        },

        extensions: ['.tsx', '.ts', '.js']
    },

    stats: {
        colors: true
    },

    plugins: [
        new webpack.DefinePlugin({
            'process.env.SSDP_COV': false,
        }),
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
