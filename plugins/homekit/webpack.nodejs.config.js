const path = require('path');
const defaultConfig = require(process.env.SCRYPTED_DEFAULT_WEBPACK_CONFIG);

// @homebridge/hap-nodejs uses readFileSync(require.resolve('package.json'))
// transform it to a plain require() which webpack handles correctly.
defaultConfig.module.rules.push({
    test: /node_modules\/@homebridge\/hap-nodejs\/dist\/lib\/model\/AccessoryInfo\.js$/,
    loader: path.resolve(__dirname, 'webpack-accessory-info-loader.js'),
    enforce: 'pre',
});

module.exports = defaultConfig;
