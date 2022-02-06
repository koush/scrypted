import { RpcMessage, RpcPeer } from '../rpc';
import { SystemManager, DeviceManager, ScryptedNativeId } from '@scrypted/types'
import { attachPluginRemote, PluginReader } from './plugin-remote';
import { PluginAPI } from './plugin-api';
import { MediaManagerImpl } from './media';
import { PassThrough } from 'stream';
import { Console } from 'console'
import { install as installSourceMapSupport } from 'source-map-support';
import net from 'net'
import { installOptionalDependencies } from './plugin-npm-dependencies';
import { createREPLServer } from './plugin-repl';

export function startPluginRemote(pluginId: string, peerSend: (message: RpcMessage, reject?: (e: Error) => void) => void) {
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
            'dir', 'time',
            'timeEnd', 'timeLog',
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

    let lastCpuUsage: NodeJS.CpuUsage;
    setInterval(() => {
        const cpuUsage = process.cpuUsage(lastCpuUsage);
        lastCpuUsage = cpuUsage;
        peer.sendOob({
            type: 'stats',
            cpu: cpuUsage,
            memoryUsage: process.memoryUsage(),
        });
    }, 10000);

    let replPort: Promise<number>;

    let _pluginConsole: Console;
    const getPluginConsole = () => {
        if (!_pluginConsole)
            _pluginConsole = getDeviceConsole(undefined);
        return _pluginConsole;
    }

    attachPluginRemote(peer, {
        createMediaManager: async (sm) => {
            systemManager = sm;
            return new MediaManagerImpl(systemManager, getPluginConsole());
        },
        onGetRemote: async (_api, _pluginId) => {
            api = _api;
            peer.selfName = pluginId;
        },
        onPluginReady: async (scrypted, params, plugin) => {
            replPort = createREPLServer(scrypted, params, plugin);
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
        async onLoadZip(pluginReader: PluginReader, packageJson: any) {
            const entry = pluginReader('main.nodejs.js.map')
            const map = entry?.toString();

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
            await installOptionalDependencies(getPluginConsole(), packageJson);
        }
    }).then(scrypted => {
        systemManager = scrypted.systemManager;
        deviceManager = scrypted.deviceManager;

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
    });

    return peer;
}
