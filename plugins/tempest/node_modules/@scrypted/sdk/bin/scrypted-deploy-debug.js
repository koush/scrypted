#! /usr/bin/env node

const scrypted = require('./index.js');

function report(err) {
    process.nextTick(() => {
        throw new Error(err);
    });
}

if (process.argv.length < 3) {
    report('Usage: npm run scrypted-deploy-debug <ip_address> [main.js]');
    return 1;
}

scrypted.deploy(process.argv[2], true)
.then(() => {
    return scrypted.debug(process.argv[2], process.argv[3]);
})
.catch((err) => {
    console.error(err.message);
    report('deploy + debug failed');
});
