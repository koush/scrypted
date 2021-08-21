const defaultWebpackConfig = require('@scrypted/sdk/bin').getDefaultWebpackConfig();
const merge = require('webpack-merge');
const path = require('path');

const webpackConfig = {
    resolve: {
        alias: {
            // disable this since, since nupnp is used
            dgram: path.resolve(__dirname, 'src/dgram'),
            // empty xml2js, since nupnp is used.
            xml2js: path.resolve(__dirname, 'src/xml2js'),
            // Q shim to es6 promise polyfill.
            q: path.resolve(__dirname, 'src/q'),
        }
    },
}

module.exports = merge(defaultWebpackConfig, webpackConfig);
