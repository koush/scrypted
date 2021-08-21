#! /usr/bin/env node
const scrypted = require('./index.js');

function report(err) {
    process.nextTick(() => {
        throw new Error(err);
    });
}

if (process.argv.length != 3) {
    // the vscode deploy+debug task will provide the main.js and connection string.
    // newer plugins will have that set to main.quickjs.js.
    // this will
    report('Usage: npm run scrypted-debug <ip_address> [main.js]');
    return 1;
}

scrypted.debug(process.argv[2], process.argv[3])
.catch((err) => {
    console.error(err.message);
    report('debug failed');
});
