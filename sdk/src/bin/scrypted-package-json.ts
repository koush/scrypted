#! /usr/bin/env node
import fs from 'fs';

interface PackageJson {
    scripts?: Record<string, string>;
    [key: string]: unknown;
}

const pkg: PackageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.scripts = Object.assign({
    "scrypted-setup-project": "scrypted-setup-project",
    "prescrypted-setup-project": "scrypted-package-json",
    "build": "scrypted-webpack",
    "preprepublishOnly": "scrypted-changelog",
    "prepublishOnly": "NODE_ENV=production scrypted-webpack",
    "prescrypted-vscode-launch": "scrypted-webpack",
    "scrypted-vscode-launch": "scrypted-deploy-debug",
    "scrypted-deploy-debug": "scrypted-deploy-debug",
    "scrypted-debug": "scrypted-debug",
    "scrypted-deploy": "scrypted-deploy",
    "scrypted-changelog": "scrypted-changelog",
    "scrypted-package-json": "scrypted-package-json",
}, pkg.scripts);
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 3) + '\n');
