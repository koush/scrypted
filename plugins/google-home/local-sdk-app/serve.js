/**
 * Copyright 2020, Google LLC
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *   http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const os = require('os');
const path = require('path');

require('array.prototype.flat/auto');
const app = require('express')();
const webpack = require('webpack');
const middleware = require('webpack-dev-middleware');

const arg = (process.argv[2] || ':8080').split(':')
const port = arg.pop();
const addr = arg.pop() || firstPublicAddress() || '0.0.0.0';
function firstPublicAddress() {
  return Object.values(os.networkInterfaces())
        .flat()
        .filter((iface) => iface.family === 'IPv4' && iface.internal === false)
        .map((iface) => iface.address)
        .shift();
}

const webpack_web = webpack(require('./webpack.config.web'));
webpack_web.hooks.done.tap('webpack.serve.js', () => {
  console.log(`[local-home-app] Chrome ondevice testing URL: http://${addr}:${port}/web/index.html`);
});

const webpack_node = webpack(require('./webpack.config.node'));
webpack_node.hooks.done.tap('webpack.serve.js', () => {
  console.log(`[local-home-app] Node ondevice testing URL:   http://${addr}:${port}/node/bundle.js`);
});

app.get('/web/index.html', (req, res) => {
  console.log('request');
  res.sendFile(path.join(__dirname, 'index.html'));
});
app.use('/web', middleware(webpack_web))
   .use('/node', middleware(webpack_node))
   .listen(port);
