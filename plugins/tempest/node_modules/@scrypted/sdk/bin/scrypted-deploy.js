#! /usr/bin/env node

const scrypted = require('./index.js');

function report(err) {
    process.nextTick(() => {
        throw new Error(err);
    });
}

if (process.argv.length != 3) {
    report('Usage: npm run scrypted-deploy <ip_address>');
    return 1;
}

scrypted.deploy(process.argv[2])
.catch((err) => {
    console.error(err.message);
    report('deploy failed');
});
