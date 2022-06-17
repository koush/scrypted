#! /usr/bin/env node
const fs = require('fs');

const pkg = JSON.parse(fs.readFileSync('package.json'));
pkg.scripts = {
    "scrypted-setup-project": "scrypted-setup-project",
    "prescrypted-setup-project": "scrypted-package-json",
    "build": "scrypted-webpack",
    "prepublishOnly": "NODE_ENV=production scrypted-webpack",
    "prescrypted-vscode-launch": "scrypted-webpack",
    "scrypted-vscode-launch": "scrypted-deploy-debug",
    "scrypted-deploy-debug": "scrypted-deploy-debug",
    "scrypted-debug": "scrypted-debug",
    "scrypted-deploy": "scrypted-deploy",
    "scrypted-readme": "scrypted-readme",
    "scrypted-package-json": "scrypted-package-json",
};
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 3) + '\n');
