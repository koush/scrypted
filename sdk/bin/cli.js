#!/usr/bin/env node
const path = require('path');
const command = path.basename(process.argv[1]);

switch (command) {
    case 'scrypted-webpack':
        require('../dist/src/bin/scrypted-webpack.js');
        break;
    case 'scrypted-deploy':
        require('../dist/src/bin/scrypted-deploy.js');
        break;
    case 'scrypted-deploy-debug':
        require('../dist/src/bin/scrypted-deploy-debug.js');
        break;
    case 'scrypted-debug':
        require('../dist/src/bin/scrypted-debug.js');
        break;
    case 'scrypted-package-json':
        require('../dist/src/bin/scrypted-package-json.js');
        break;
    case 'scrypted-changelog':
        require('../dist/src/bin/scrypted-changelog.js');
        break;
    case 'scrypted-setup-project':
        require('../dist/src/bin/scrypted-setup-project.js');
        break;
    default:
        console.error(`Unknown command: ${command}`);
        process.exit(1);
}
