const path = require('path');
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');

const scryptedServer = 'https://127.0.0.1:9443';

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
  productionSourceMap: false,

  // https://cli.vuejs.org/config/#css-extract
  css: {
    extract: { ignoreOrder: true },
    loaderOptions: {
      sass: {
        additionalData: '@import \'~@/assets/scss/vuetify/variables\''
      },
      scss: {
        additionalData: '@import \'~@/assets/scss/vuetify/variables\';'
      }
    }
  },

  
  parallel: false,

  chainWebpack: config => {
    config.module.rule('vue').uses.delete('cache-loader');
    config.module.rule('js').uses.delete('cache-loader');
    config.module.rule('ts').uses.delete('cache-loader');
    config.module.rule('tsx').uses.delete('cache-loader');

    // config.module
    //   .rule('worker-loader')
    //   .test(/\.worker\.js$/)
    //   .use('worker-loader')
    //   .loader('worker-loader')
    //   .end()
  },


  configureWebpack: {
    output: {
      crossOriginLoading: 'anonymous',
    },
    plugins: [
      new MonacoWebpackPlugin()
    ],
    module: {
      rules: [
        {
          test: /\.(wasm\.asset)$/i,
          use: [
            {
              loader: 'file-loader',
              options: {
                name: '[contenthash].wasm'
              }
            },
          ],
        },
      ]
    },
  },

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
