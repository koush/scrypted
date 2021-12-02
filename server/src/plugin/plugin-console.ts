import { ScryptedNativeId } from '@scrypted/sdk/types'
import { EventEmitter } from 'ws';
import { listenZero } from './listen-zero';
import { Server } from 'net';
import { once } from 'events';
import net from 'net'
import { Readable } from 'stream';

export interface ConsoleServer {
    readPort: number,
    writePort: number,
    readServer: net.Server,
    writeServer: net.Server,
    sockets: Set<net.Socket>;
}
export async function createConsoleServer(stdout: Readable, stderr: Readable) {
    const outputs = new Map<string, Buffer[]>();
    const appendOutput = (data: Buffer, nativeId: ScryptedNativeId) => {
        if (!nativeId)
            nativeId = undefined;
        let buffers = outputs.get(nativeId);
        if (!buffers) {
            buffers = [];
            outputs.set(nativeId, buffers);
        }
        buffers.push(data);
        // when we're over 4000 lines or whatever these buffer are,
        // truncate down to 2000.
        if (buffers.length > 4000)
            outputs.set(nativeId, buffers.slice(buffers.length - 2000))
    };

    const sockets = new Set<net.Socket>();

    const events = new EventEmitter();
    events.on('stdout', appendOutput);
    events.on('stderr', appendOutput);

    stdout.on('data', data => events.emit('stdout', data));
    stderr.on('data', data => events.emit('stderr', data));

    const readServer = new Server(async (socket) => {
        sockets.add(socket);

        let [filter] = await once(socket, 'data');
        filter = filter.toString().trim();
        if (filter === 'undefined')
            filter = undefined;

        const buffers = outputs.get(filter);
        if (buffers) {
            const concat = Buffer.concat(buffers);
            outputs.set(filter, [concat]);
            socket.write(concat);
        }

        const cb = (data: Buffer, nativeId: ScryptedNativeId) => {
            if (nativeId !== filter)
                return;
            socket.write(data);
        };
        events.on('stdout', cb)
        events.on('stderr', cb)

        const cleanup = () => {
            events.removeListener('stdout', cb);
            events.removeListener('stderr', cb);
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

        const cb = (data: Buffer) => events.emit('stdout', data, filter);

        socket.on('data', cb);

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
        readPort,
        writePort,
        readServer,
        writeServer,
        sockets,
    };
}
