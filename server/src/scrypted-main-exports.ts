import dns from 'dns';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import process from 'process';
import semver from 'semver';
import v8 from 'v8';
import vm from 'vm';
import { PluginError } from './plugin/plugin-error';
import { getScryptedVolume } from './plugin/plugin-volume';
import { RPCResultError, startPeriodicGarbageCollection } from './rpc';
import type { Runtime } from './scrypted-server-main';
import { isNodePluginWorkerProcess } from './plugin/runtime/node-fork-worker';


function start(mainFilename: string, options?: {
    onRuntimeCreated?: (runtime: Runtime) => Promise<void>,
}) {
    // Allow including a custom file path for platforms that require
    // compatibility hacks. For example, Android may need to patch
    // os functions.
    if (process.env.SCRYPTED_COMPATIBILITY_FILE && fs.existsSync(process.env.SCRYPTED_COMPATIBILITY_FILE)) {
        require(process.env.SCRYPTED_COMPATIBILITY_FILE);
    }

    if (!globalThis.gc) {
        v8.setFlagsFromString('--expose_gc')
        globalThis.gc = vm.runInNewContext("gc");
    }

    if (!semver.gte(process.version, '16.0.0')) {
        throw new Error('"node" version out of date. Please update node to v16 or higher.')
    }

    // Node 17 changes the dns resolution order to return the record order.
    // This causes issues with clients that are on "IPv6" networks that are
    // actually busted and fail to connect to npm's IPv6 address.
    // The workaround is to favor IPv4.
    dns.setDefaultResultOrder('ipv4first');

    startPeriodicGarbageCollection();

    if (isNodePluginWorkerProcess()) {
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
                console.error('fatal error', error);
                throw error;
            }
            console.warn('unhandled rejection of RPC Result', error);
        });

        dotenv.config({
            path: path.join(getScryptedVolume(), '.env'),
        });

        const start = require('./scrypted-server-main').default;
        return start(mainFilename, options);
    }
}

export default start;
