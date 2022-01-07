import process from 'process';
import semver from 'semver';
import { RPCResultError } from './rpc';
import { PluginError } from './plugin/plugin-error';

if (!semver.gte(process.version, '16.0.0')) {
    throw new Error('"node" version out of date. Please update node to v16 or higher.')
}

process.on('unhandledRejection', error => {
    if (error?.constructor !== RPCResultError && error?.constructor !== PluginError) {
        throw error;
    }
    console.warn('unhandled rejection of RPC Result', error);
});

if (process.argv[2] === 'child') {
    require('./scrypted-plugin-main');
}
else {
    require('./scrypted-server-main');
}
