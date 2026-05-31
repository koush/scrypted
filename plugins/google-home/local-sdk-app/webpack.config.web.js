const path = require('path');

module.exports = {
  mode: 'production',
  target: 'web',
  entry: './index.ts',
  output: {
    path: path.resolve(__dirname, '../../../docs/plugins/google-home/local-sdk-app/web/'),
    filename: 'bundle.js'
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        loader: 'ts-loader'
      }
    ]
  },
  resolve: {
    extensions: [ '.ts', '.js' ]
  }
};
