import { DeviceManager, ScryptedNativeId, ScryptedStatic, SystemManager } from '@scrypted/types';
import AdmZip from 'adm-zip';
import { Console } from 'console';
import fs from 'fs';
import { Volume } from 'memfs';
import net from 'net';
import path from 'path';
import { install as installSourceMapSupport } from 'source-map-support';
import { PassThrough } from 'stream';
import { RpcMessage, RpcPeer } from '../rpc';
import { MediaManagerImpl } from './media';
import { PluginAPI, PluginRemoteLoadZipOptions } from './plugin-api';
import { installOptionalDependencies } from './plugin-npm-dependencies';
import { attachPluginRemote, PluginReader, setupPluginRemote } from './plugin-remote';
import { createREPLServer } from './plugin-repl';
import { NodeThreadWorker } from './runtime/node-thread-worker';
const { link } = require('linkfs');

export function startPluginRemote(pluginId: string, peerSend: (message: RpcMessage, reject?: (e: Error) => void, serializationContext?: any) => void) {
    const peer = new RpcPeer('unknown', 'host', peerSend);

    let systemManager: SystemManager;
    let deviceManager: DeviceManager;
    let api: PluginAPI;

    const getConsole = (hook: (stdout: PassThrough, stderr: PassThrough) => Promise<void>,
        also?: Console, alsoPrefix?: string) => {

        const stdout = new PassThrough();
        const stderr = new PassThrough();

        hook(stdout, stderr);

        const ret = new Console(stdout, stderr);

        const methods = [
            'log', 'warn',
            'dir', 'timeLog',
            'trace', 'assert',
            'clear', 'count',
            'countReset', 'group',
            'groupEnd', 'table',
            'debug', 'info',
            'dirxml', 'error',
            'groupCollapsed',
        ];

        const printers = ['log', 'info', 'debug', 'trace', 'warn', 'error'];
        for (const m of methods) {
            const old = (ret as any)[m].bind(ret);
            (ret as any)[m] = (...args: any[]) => {
                // prefer the mixin version for local/remote console dump.
                if (also && alsoPrefix && printers.includes(m)) {
                    (also as any)[m](alsoPrefix, ...args);
                }
                else {
                    (console as any)[m](...args);
                }
                // call through to old method to ensure it gets written
                // to log buffer.
                old(...args);
            }
        }

        return ret;
    }

    let pluginsPromise: Promise<any>;
    function getPlugins() {
        if (!pluginsPromise)
            pluginsPromise = api.getComponent('plugins');
        return pluginsPromise;
    }

    const getDeviceConsole = (nativeId?: ScryptedNativeId) => {
        // the the plugin console is simply the default console
        // and gets read from stderr/stdout.
        if (!nativeId)
            return console;

        return getConsole(async (stdout, stderr) => {
            const connect = async () => {
                const plugins = await getPlugins();
                const port = await plugins.getRemoteServicePort(peer.selfName, 'console-writer');
                const socket = net.connect(port);
                socket.write(nativeId + '\n');
                const writer = (data: Buffer) => {
                    socket.write(data);
                };
                stdout.on('data', writer);
                stderr.on('data', writer);
                socket.on('error', () => {
                    stdout.removeAllListeners();
                    stderr.removeAllListeners();
                    stdout.pause();
                    stderr.pause();
                    setTimeout(connect, 10000);
                });
            };
            connect();
        }, undefined, undefined);
    }

    const getMixinConsole = (mixinId: string, nativeId: ScryptedNativeId) => {
        return getConsole(async (stdout, stderr) => {
            if (!mixinId) {
                return;
            }
            // todo: fix this. a mixin provider can mixin another device to make it a mixin provider itself.
            // so the mixin id in the mixin table will be incorrect.
            // there's no easy way to fix this from the remote.
            // if (!systemManager.getDeviceById(mixinId).mixins.includes(idForNativeId(nativeId))) {
            //     return;
            // }
            const reconnect = () => {
                stdout.removeAllListeners();
                stderr.removeAllListeners();
                stdout.pause();
                stderr.pause();
                setTimeout(tryConnect, 10000);
            };

            const connect = async () => {
                const ds = deviceManager.getDeviceState(nativeId);
                if (!ds) {
                    // deleted?
                    return;
                }

                const plugins = await getPlugins();
                const { pluginId, nativeId: mixinNativeId } = await plugins.getDeviceInfo(mixinId);
                const port = await plugins.getRemoteServicePort(pluginId, 'console-writer');
                const socket = net.connect(port);
                socket.write(mixinNativeId + '\n');
                const writer = (data: Buffer) => {
                    let str = data.toString().trim();
                    str = str.replaceAll('\n', `\n[${ds.name}]: `);
                    str = `[${ds.name}]: ` + str + '\n';
                    socket.write(str);
                };
                stdout.on('data', writer);
                stderr.on('data', writer);
                socket.on('close', reconnect);
            };

            const tryConnect = async () => {
                try {
                    await connect();
                }
                catch (e) {
                    reconnect();
                }
            }
            tryConnect();
        }, getDeviceConsole(nativeId), `[${systemManager.getDeviceById(mixinId)?.name}]`);
    }

    peer.getParam('updateStats').then((updateStats: (stats: any) => void) => {
        let lastCpuUsage: NodeJS.CpuUsage;
        setInterval(() => {
            const cpuUsage = process.cpuUsage(lastCpuUsage);
            lastCpuUsage = cpuUsage;
            updateStats({
                type: 'stats',
                cpu: cpuUsage,
                memoryUsage: process.memoryUsage(),
            });
        }, 10000);
    });

    let replPort: Promise<number>;

    let _pluginConsole: Console;
    const getPluginConsole = () => {
        if (!_pluginConsole)
            _pluginConsole = getDeviceConsole(undefined);
        return _pluginConsole;
    }

    let postInstallSourceMapSupport: (scrypted: ScryptedStatic) => void;

    attachPluginRemote(peer, {
        createMediaManager: async (sm, dm) => {
            systemManager = sm;
            deviceManager = dm
            return new MediaManagerImpl(systemManager, dm);
        },
        onGetRemote: async (_api, _pluginId) => {
            api = _api;
            peer.selfName = pluginId;
        },
        getPluginConsole,
        getDeviceConsole,
        getMixinConsole,
        async getServicePort(name, ...args: any[]) {
            if (name === 'repl') {
                if (!replPort)
                    throw new Error('REPL unavailable: Plugin not loaded.')
                return replPort;
            }
            throw new Error(`unknown service ${name}`);
        },
        async onLoadZip(scrypted: ScryptedStatic, params: any, packageJson: any, zipData: Buffer | string, zipOptions?: PluginRemoteLoadZipOptions) {
            let volume: any;
            let pluginReader: PluginReader;
            if (zipOptions?.unzippedPath && fs.existsSync(zipOptions?.unzippedPath)) {
                volume = link(fs, ['', path.join(zipOptions.unzippedPath, 'fs')]);
                pluginReader = name => {
                    const filename = path.join(zipOptions.unzippedPath, name);
                    if (!fs.existsSync(filename))
                        return;
                    return fs.readFileSync(filename);
                };
            }
            else {
                const admZip = new AdmZip(zipData);
                volume = new Volume();
                for (const entry of admZip.getEntries()) {
                    if (entry.isDirectory)
                        continue;
                    if (!entry.entryName.startsWith('fs/'))
                        continue;
                    const name = entry.entryName.substring('fs/'.length);
                    volume.mkdirpSync(path.dirname(name));
                    const data = entry.getData();
                    volume.writeFileSync(name, data);
                }

                pluginReader = name => {
                    const entry = admZip.getEntry(name);
                    if (!entry)
                        return;
                    return entry.getData();
                }
            }
            zipData = undefined;

            const pluginConsole = getPluginConsole?.();
            params.console = pluginConsole;
            params.require = (name: string) => {
                if (name === 'fakefs' || (name === 'fs' && !packageJson.scrypted.realfs)) {
                    return volume;
                }
                if (name === 'realfs') {
                    return require('fs');
                }
                const module = require(name);
                return module;
            };
            const window: any = {};
            const exports: any = window;
            window.exports = exports;
            params.window = window;
            params.exports = exports;

            const entry = pluginReader('main.nodejs.js.map')
            const map = entry?.toString();

            // plugins may install their own sourcemap support during startup, so
            // hook the sourcemap installation after everything is loaded.
            postInstallSourceMapSupport = (scrypted) => {
                process.removeAllListeners('uncaughtException');
                process.removeAllListeners('unhandledRejection');

                process.on('uncaughtException', e => {
                    getPluginConsole().error('uncaughtException', e);
                    scrypted.log.e('uncaughtException ' + e?.toString());
                });
                process.on('unhandledRejection', e => {
                    getPluginConsole().error('unhandledRejection', e);
                    scrypted.log.e('unhandledRejection ' + e?.toString());
                });

                installSourceMapSupport({
                    environment: 'node',
                    retrieveSourceMap(source) {
                        if (source === '/plugin/main.nodejs.js' || source === `/${pluginId}/main.nodejs.js`) {
                            if (!map)
                                return null;
                            return {
                                url: '/plugin/main.nodejs.js',
                                map,
                            }
                        }
                        return null;
                    }
                });
            };

            await installOptionalDependencies(getPluginConsole(), packageJson);

            const main = pluginReader('main.nodejs.js');
            pluginReader = undefined;
            const script = main.toString();

            scrypted.fork = async () => {
                const ntw = new NodeThreadWorker(pluginId, {
                    env: process.env,
                    pluginDebug: undefined,
                });
                const threadPeer = new RpcPeer('main', 'thread', (message, reject) => ntw.send(message, reject));
                threadPeer.params.updateStats = (stats: any) => {
                    // todo: merge.
                    // this.stats = stats;
                }
                ntw.setupRpcPeer(threadPeer);

                const remote = await setupPluginRemote(threadPeer, api, pluginId, () => systemManager.getSystemState());
                const forkOptions = Object.assign({}, zipOptions);
                forkOptions.fork = true;
                return remote.loadZip(packageJson, zipData, forkOptions)
            }

            try {
                peer.evalLocal(script, zipOptions?.filename || '/plugin/main.nodejs.js', params);
                pluginConsole?.log('plugin successfully loaded');

                if (zipOptions?.fork) {
                    const fork = exports.fork;
                    const ret = await fork();
                    ret[RpcPeer.PROPERTY_JSON_DISABLE_SERIALIZATION] = true;
                    return ret;
                }

                let pluginInstance = exports.default;
                // support exporting a plugin class, plugin main function,
                // or a plugin instance
                if (pluginInstance.toString().startsWith('class '))
                    pluginInstance = new pluginInstance();
                if (typeof pluginInstance === 'function')
                    pluginInstance = await pluginInstance();

                replPort = createREPLServer(scrypted, params, pluginInstance);
                postInstallSourceMapSupport(scrypted);

                return pluginInstance;
            }
            catch (e) {
                pluginConsole?.error('plugin failed to start', e);
                throw e;
            }
        }
    }).then(scrypted => {
        systemManager = scrypted.systemManager;
        deviceManager = scrypted.deviceManager;
    });

    return peer;
}
