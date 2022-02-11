import process from 'process';
import semver from 'semver';
import { RPCResultError, startPeriodicGarbageCollection } from './rpc';
import { PluginError } from './plugin/plugin-error';

if (!semver.gte(process.version, '16.0.0')) {
    throw new Error('"node" version out of date. Please update node to v16 or higher.')
}

startPeriodicGarbageCollection();

if (process.argv[2] === 'child' || process.argv[2] === 'child-thread') {
    process.on('uncaughtException', e => {
        console.error('uncaughtException', e);
    });
    process.on('unhandledRejection', e => {
        console.error('unhandledRejection', e);
    });

    require('./scrypted-plugin-main');
}
else {
    process.on('unhandledRejection', error => {
        if (error?.constructor !== RPCResultError && error?.constructor !== PluginError) {
            console.error('wtf', error);
            throw error;
        }
        console.warn('unhandled rejection of RPC Result', error);
    });

    require('./scrypted-server-main');
}
