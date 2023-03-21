import v8 from 'v8';
import vm from 'vm';
import process from 'process';
import semver from 'semver';
import { RPCResultError, startPeriodicGarbageCollection } from './rpc';
import { PluginError } from './plugin/plugin-error';
import type { Runtime } from './scrypted-server-main';

export function isChildProcess() {
    return process.argv[2] === 'child' || process.argv[2] === 'child-thread'
}

function start(mainFilename: string, options?: {
    onRuntimeCreated?: (runtime: Runtime) => Promise<void>,
}) {
    if (!global.gc) {
        v8.setFlagsFromString('--expose_gc')
        global.gc = vm.runInNewContext("gc");
    }

    if (!semver.gte(process.version, '16.0.0')) {
        throw new Error('"node" version out of date. Please update node to v16 or higher.')
    }

    // Node 17 changes the dns resolution order to return the record order.
    // This causes issues with clients that are on "IPv6" networks that are
    // actually busted and fail to connect to npm's IPv6 address.
    // The workaround is to favor IPv4.
    process.env['NODE_OPTIONS'] = '--dns-result-order=ipv4first';

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

        const start = require('./scrypted-plugin-main').default;
        return start(mainFilename);
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

        const start = require('./scrypted-server-main').default;
        return start(mainFilename, options);
    }
}

export default start;
