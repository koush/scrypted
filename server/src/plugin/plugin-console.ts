import { ScryptedNativeId } from '@scrypted/types'
import { listenZero } from './listen-zero';
import { Server } from 'net';
import { once } from 'events';
import net from 'net'
import { Readable, PassThrough } from 'stream';
import { Console } from 'console';

export interface ConsoleServer {
    pluginConsole: Console;
    readPort: number,
    writePort: number,
    destroy(): void;
}

export interface StdPassThroughs {
    stdout: PassThrough;
    stderr: PassThrough;
    buffers: Buffer[];
}

export async function createConsoleServer(remoteStdout: Readable, remoteStderr: Readable) {
    const outputs = new Map<string, StdPassThroughs>();

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

            const appendOutput = (data: Buffer) => {
                const { buffers } = pts;
                buffers.push(data);
                // when we're over 4000 lines or whatever these buffer are,
                // truncate down to 2000.
                if (buffers.length > 4000)
                    pts.buffers = buffers.slice(buffers.length - 2000);
            };

            stdout.on('data', appendOutput);
            stderr.on('data', appendOutput);
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

    const readServer = new Server(async (socket) => {
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

    const writeServer = new Server(async (socket) => {
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
    const readPort = await listenZero(readServer);
    const writePort = await listenZero(writeServer);

    return {
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
