import { DeviceManager, ScryptedNativeId, SystemManager } from '@scrypted/types';
import { Console } from 'console';
import { once } from 'events';
import net from 'net';
import { PassThrough, Readable, Writable } from 'stream';
import { clusterListenZero } from '../cluster/cluster-setup';

export interface ConsoleServer {
    pluginConsole: Console;
    readPort: number,
    writePort: number,
    destroy(): void;
    clear(nativeId: ScryptedNativeId): void;
}

export interface StdPassThroughs {
    stdout: PassThrough;
    stderr: PassThrough;
    buffers: Buffer[];
}

export function getConsole(hook: (stdout: PassThrough, stderr: PassThrough) => Promise<void>,
    also?: Console, alsoPrefix?: string) {

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

export function prepareConsoles(getConsoleName: () => string, systemManager: () => SystemManager, deviceManager: () => DeviceManager, getPlugins: () => Promise<any>) {
    const deviceConsoles = new Map<string, Console>();
    function getDeviceConsole(nativeId?: ScryptedNativeId) {
        // the the plugin console is simply the default console
        // and gets read from stderr/stdout.
        if (!nativeId)
            return console;

        let ret = deviceConsoles.get(nativeId);
        if (ret)
            return ret;

        ret = getConsole(async (stdout, stderr) => {
            const connect = async () => {
                const plugins = await getPlugins();
                const [port, host] = await plugins.getRemoteServicePort(getConsoleName(), 'console-writer');
                const socket = net.connect({
                    port,
                    host,
                });
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

        deviceConsoles.set(nativeId, ret);
        return ret;
    }

    const mixinConsoles = new Map<string, Map<string, Console>>();

    function getMixinConsole(mixinId: string, nativeId: ScryptedNativeId) {
        let nativeIdConsoles = mixinConsoles.get(nativeId);
        if (!nativeIdConsoles) {
            nativeIdConsoles = new Map();
            mixinConsoles.set(nativeId, nativeIdConsoles);
        }

        let ret = nativeIdConsoles.get(mixinId);
        if (ret)
            return ret;

        ret = getConsole(async (stdout, stderr) => {
            if (!mixinId) {
                return;
            }
            const reconnect = () => {
                stdout.removeAllListeners();
                stderr.removeAllListeners();
                stdout.pause();
                stderr.pause();
                setTimeout(tryConnect, 10000);
            };

            const connect = async () => {
                const ds = deviceManager().getDeviceState(nativeId);
                // device deleted
                if (!ds)
                    return;

                const plugins = await getPlugins();
                const mixin = systemManager().getDeviceById(mixinId);
                // mixin deleted
                if (!mixin)
                    return;
                const { pluginId, nativeId: mixinNativeId } = mixin;
                const [port, host] = await plugins.getRemoteServicePort(pluginId, 'console-writer');
                const socket = net.connect({
                    port,
                    host,
                });
                socket.on('error', () => { });
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
        }, getDeviceConsole(nativeId), `[${systemManager().getDeviceById(mixinId)?.name}]`);

        nativeIdConsoles.set(mixinId, ret);
        return ret;
    }

    return {
        getDeviceConsole,
        getMixinConsole,
    }
}

export async function createConsoleServer(remoteStdout: Readable, remoteStderr: Readable, header: string) {
    const outputs = new Map<string, StdPassThroughs>();

    const addHeader = (pts: StdPassThroughs) => {
        pts.buffers.push(Buffer.from(header));
    }

    const getPassthroughs = (nativeId?: ScryptedNativeId) => {
        if (!nativeId)
            nativeId = undefined;
        let pts = outputs.get(nativeId)
        if (!pts) {
            const stdout = new PassThrough();
            const stderr = new PassThrough();

            pts = {
                stdout,
                stderr,
                buffers: [],
            }
            outputs.set(nativeId, pts);

            let writeTimestamp = true;
            let timestampTimer: NodeJS.Timeout;
            stdout.on('close', () => clearTimeout(timestampTimer));
            stderr.on('close', () => clearTimeout(timestampTimer));

            const appendOutput = (data: Buffer) => {
                const { buffers } = pts;

                if (writeTimestamp) {
                    writeTimestamp = false;
                    buffers.push(Buffer.from(`########################\n`));
                    buffers.push(Buffer.from(`${new Date().toLocaleString()}\n`));
                    buffers.push(Buffer.from(`########################\n`));
                    timestampTimer = setTimeout(() => writeTimestamp = true, 5 * 60 * 1000);
                }

                buffers.push(data);
                // when we're over 4000 lines or whatever these buffer are,
                // truncate down to 2000.
                if (buffers.length > 4000)
                    pts.buffers = buffers.slice(buffers.length - 2000);
            };

            stdout.on('data', appendOutput);
            stderr.on('data', appendOutput);

            addHeader(pts);
        }

        return pts;
    }

    let pluginConsole: Console;
    {
        const { stdout, stderr } = getPassthroughs();
        remoteStdout.pipe(stdout);
        remoteStderr.pipe(stderr);
        pluginConsole = new Console(stdout, stderr);
    }

    const sockets = new Set<net.Socket>();

    const { server: readServer, port: readPort } = await clusterListenZero(async (socket) => {
        sockets.add(socket);

        let [filter] = await once(socket, 'data');
        filter = filter.toString().trim();
        if (filter === 'undefined')
            filter = undefined;

        const pts = outputs.get(filter);
        const buffers = pts?.buffers;
        if (buffers) {
            const concat = Buffer.concat(buffers);
            pts.buffers = [concat];
            socket.write(concat);
        }

        const cb = (data: Buffer) => socket.write(data);
        const { stdout, stderr } = getPassthroughs(filter);
        stdout.on('data', cb);
        stderr.on('data', cb);

        const cleanup = () => {
            stdout.removeListener('data', cb);
            stderr.removeListener('data', cb);
            socket.destroy();
            socket.removeAllListeners();
            sockets.delete(socket);
        };

        socket.on('close', cleanup);
        socket.on('error', cleanup);
        socket.on('end', cleanup);
    });

    const { server: writeServer, port: writePort } = await clusterListenZero(async (socket) => {
        sockets.add(socket);
        const [data] = await once(socket, 'data');
        let filter: string = data.toString();
        const newline = filter.indexOf('\n');
        if (newline !== -1) {
            socket.unshift(Buffer.from(filter.substring(newline + 1)));
        }
        filter = filter.substring(0, newline);

        if (filter === 'undefined')
            filter = undefined;

        const { stdout } = getPassthroughs(filter);
        socket.pipe(stdout, { end: false });

        const cleanup = () => {
            socket.destroy();
            socket.removeAllListeners();
            sockets.delete(socket);
        };

        socket.once('close', cleanup);
        socket.once('error', cleanup);
        socket.once('end', cleanup);
    });

    return {
        clear(nativeId: ScryptedNativeId) {
            const pt = outputs.get(nativeId);
            if (pt)
                pt.buffers = [];
            addHeader(pt);
        },
        destroy() {
            for (const socket of sockets) {
                socket.destroy();
            }
            sockets.clear();
            outputs.clear();

            try {
                readServer.close();
                writeServer.close();
            }
            catch (e) {
            }
        },
        pluginConsole,
        readPort,
        writePort,
    };
}

export function pipeWorkerConsole(nativeWorker: { stdout: Readable, stderr: Readable }, useConsole = console) {
    nativeWorker.stdout.on('data', (data) => {
        useConsole.log(data.toString());
    });
    nativeWorker.stderr.on('data', (data) => {
        useConsole.error(data.toString());
    });
}

export async function writeWorkerGenerator(asyncIterator: AsyncGenerator<Buffer>, writable: Writable) {
    try {
        for await (const data of asyncIterator) {
            writable.write(data);
        }
    }
    catch (e) {
    }
}
