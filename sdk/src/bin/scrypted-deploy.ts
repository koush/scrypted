#! /usr/bin/env node
import * as scrypted from './index.js';

function report(err: string): void {
    process.nextTick(() => {
        throw new Error(err);
    });
}

if (process.argv.length != 3) {
    report('Usage: npm run scrypted-deploy <ip_address>');
    process.exit(1);
}

scrypted.deploy(process.argv[2])
    .catch((err: Error) => {
        console.error(err.message);
        report('deploy failed');
    });
