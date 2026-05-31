#! /usr/bin/env node
import * as scrypted from './index.js';

function report(err: string): void {
    process.nextTick(() => {
        throw new Error(err);
    });
}

if (process.argv.length != 3) {
    report('Usage: npm run scrypted-debug <ip_address> [main.js]');
    process.exit(1);
}

scrypted.debug(process.argv[2], process.argv[3])
    .catch((err: Error) => {
        console.error(err.message);
        report('debug failed');
    });
