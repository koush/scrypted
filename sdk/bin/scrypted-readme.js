#! /usr/bin/env node
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json'));
const { description } = pkg;

const title = (description || pkg.name).replace(' for Scrypted', '');

const readme = 
`# ${title}

## npm commands
 * npm run build
 * npm run scrypted-deploy <ipaddress>
 * npm run scrypted-debug <ipaddress>

## scrypted distribution via npm
 1. Ensure package.json is set up properly for publishing on npm.
 2. npm publish

## Visual Studio Code configuration

* If using a remote server, edit [.vscode/settings.json](blob/master/.vscode/settings.json) to specify the IP Address of the Scrypted server.
* Launch Scrypted Debugger from the launch menu.
`;

fs.writeFileSync('README.md', readme);
