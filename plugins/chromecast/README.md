# Sample Scrypted Plugin with Visual Studio Code support

## npm commands
 * npm run scrypted-webpack
 * npm run scrypted-deploy <ipaddress>
 * npm run scrypted-debug <ipaddress>

## scrypted distribution via npm
 1. Ensure package.json is set up properly for publishing on npm.
 2. NODE_ENV=production npm run scrypted-webpack
 3. git add dist/main.js
 4. git commit
 5. npm publish

## Visual Studio Code configuration

* Install the [Duktape Debugger Extension](https://marketplace.visualstudio.com/items?itemName=koush.duk-debug)

* Edit [.vscode/settings.json](https://github.com/koush/scrypted-vscode/blob/master/.vscode/settings.json) to specify the IP Address of the Scrypted server.
* Launch Scrypted Debugger from the launch menu.
