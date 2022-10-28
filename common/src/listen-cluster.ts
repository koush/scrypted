import net from 'net';
import { once } from 'events';
import dgram, { SocketType } from 'dgram';

export async function closeQuiet(socket: dgram.Socket | net.Server) {
    if (!socket)
        return;
    try {
        await new Promise(resolve => socket.close(resolve));
    }
    catch (e) {
    }
}

export async function bindUdp(server: dgram.Socket, usePort: number, address?: string) {
    server.bind(usePort, address);
    await once(server, 'listening');
    const port = server.address().port;
    return {
        port,
        url: `udp://127.0.0.1:${port}`,
    }
}

export async function bindZero(server: dgram.Socket) {
    return bindUdp(server, 0);
}

export async function createBindZero(socketType?: SocketType) {
    return createBindUdp(0, socketType);
}

export async function reserveUdpPort() {
    const udp = await createBindZero();
    await new Promise(resolve => udp.server.close(() => resolve(undefined)));
    return udp.port;
}

export async function createBindUdp(usePort: number, socketType?: SocketType) {
    const server = dgram.createSocket(socketType || 'udp4');
    const { port, url } = await bindUdp(server, usePort);
    return {
        server,
        port,
        url,
    };
}

export async function bind(server: dgram.Socket, port: number) {
    server.bind(port);
    await once(server, 'listening');
    return {
        port,
        url: `udp://127.0.0.1:${port}`,
    }
}

export { listenZero, listenZeroSingleClient } from "@scrypted/server/src/listen-zero";
