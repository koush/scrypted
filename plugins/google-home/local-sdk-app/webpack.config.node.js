const path = require('path');

module.exports = {
  mode: 'production',
  target: 'node',
  entry: './index.ts',
  output: {
    path: path.resolve(__dirname, '../docs/local-sdk-app/node/'),
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
  },
};
