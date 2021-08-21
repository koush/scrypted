const path = require('path');

const scryptedServer = 'https://192.168.2.206:9443';

const proxyOpts = {
  changeOrigin: true,
  ws: true,
  target: scryptedServer,
  onProxyReq: (proxyReq) => {
    // required by scrypted which does referer host check when something POSTs to it.
    // cross origin posts not allowed. is this automatically done by the browser?
    proxyReq.removeHeader('Referer');
  },
};

module.exports = {
  pwa: {
    themeColor: '#424242',
    msTileColor: '#9c27b0',
    appleMobileWebAppStatusBarStyle: 'black',
    workboxOptions: {
      skipWaiting: true,
      // clientsClaim: true,
    }
  },
  publicPath: process.env.NODE_ENV === 'production' ? '/endpoint/@scrypted/core/public' : '/',
  configureWebpack: {
    resolve: {
      extensions: ['.js', '.ts', '.vue'],
    },
    module: {
      rules: [
        {
          test: /\.(ts|js)?$/,
          use: ["source-map-loader"],
          enforce: "pre"
        },
        {
          test: /\.(ts|js)x?$/,
          // unsure if this is correct... need to transpile node modules at times.
          exclude: /(node_modules|bower_components)/,
          use: {
            loader: 'babel-loader',
          }
        }
      ]
    },
  },
  chainWebpack: config => config.resolve.symlinks(false),
  runtimeCompiler: true,
  devServer: {
    port: 8081,
    disableHostCheck: true,
    // public: 'home.scrypted.app',
    https: true,
    proxy: {
      '^/(login|logout|static|endpoint|whitelist|web)': proxyOpts,
    }
  }
}

if (process.env['NODE_ENV'] == 'production') {
  module.exports.configureWebpack.devtool = 'none';
}
