import net from 'net';
import { once } from 'events';
import express from 'express';

export async function listenZero(server: net.Server) {
    server.listen(0);
    await once(server, 'listening');
    return (server.address() as net.AddressInfo).port;
}

export function listenZeroExpress(app: express.Express) {
    const server = app.listen(0);
    return {
        server,
        port: (async () => {
            await once(server, 'listening');
            const { port } = (server.address() as net.AddressInfo);
            return port;
        })()
    }
}
