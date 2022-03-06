import process from 'process';
import semver from 'semver';
import { RPCResultError, startPeriodicGarbageCollection } from './rpc';
import { PluginError } from './plugin/plugin-error';

if (!semver.gte(process.version, '16.0.0')) {
    throw new Error('"node" version out of date. Please update node to v16 or higher.')
}

startPeriodicGarbageCollection();

if (process.argv[2] === 'child' || process.argv[2] === 'child-thread') {
    // plugins should never crash. this handler will be removed, and then readded
    // after the plugin source map is retrieved.
    process.on('uncaughtException', e => {
        console.error('uncaughtException', e);
    });
    process.on('unhandledRejection', e => {
        console.error('unhandledRejection', e);
    });

    require('./scrypted-plugin-main');
}
else {
    // unhandled rejections are allowed if they are from a rpc/plugin call.
    process.on('unhandledRejection', error => {
        if (error?.constructor !== RPCResultError && error?.constructor !== PluginError) {
            console.error('wtf', error);
            throw error;
        }
        console.warn('unhandled rejection of RPC Result', error);
    });

    require('./scrypted-server-main');
}
