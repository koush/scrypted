const path = require('path');
const webpack = require('webpack');

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
        libraryTarget: "window",
    },
    module: {
        rules: [
            {
                test: /\.(ts|js)x?$/,
                // unsure if this is correct... need to transpile node modules at times.
                // exclude: /(node_modules|bower_components)/,
                exclude: /(core-js)/,
                use: {
                    loader: 'babel-loader',
                    options: {
                        "plugins": [
                            "babel-plugin-const-enum",
                            "@babel/plugin-transform-typescript",
                            "@babel/plugin-proposal-class-properties",
                            // currently still necessary due to how Quack evaluates expecting commonjs.
                            "@babel/plugin-transform-modules-commonjs",
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
            //         configFile : path.join(__dirname, 'tsconfig.json'),
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
            ByteBuffer: "bytebuffer",
            Long: "long",

            // browser provide plugin polyfills
            wrtc: path.resolve(__dirname, 'polyfill/wrtc'),
            mdns: path.resolve(__dirname, 'polyfill/mdns'),
            serialport: path.resolve(__dirname, 'polyfill/serialport'),
            'zwave-js': path.resolve(__dirname, 'polyfill/zwave-js'),
            typescript: path.resolve(__dirname, 'polyfill/typescript'),
            '@koush/opencv4nodejs': path.resolve(__dirname, 'polyfill/opencv4nodejs'),
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
        // can not minimize since duktape only does line based breakpoints
        // so only minimize in production.
        // UPDATE: this may not be true. unable to determine cause. could be
        // some textarea copy paste behavior that occurred while I was testing.
        // minimize: false,
        minimize: isProduction,
    },

    devtool: 'source-map',
};
