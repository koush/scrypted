import net, { AddressInfo } from 'net';
import { once } from 'events';
import dgram from 'dgram';

export async function listenZero(server: net.Server) {
    server.listen(0);
    await once(server, 'listening');
    return (server.address() as net.AddressInfo).port;
}

export async function bindZero(server: dgram.Socket) {
    server.bind(0);
    await once(server, 'listening');
    return (server.address() as net.AddressInfo).port;
}

export async function listenZeroSingleClient() {
    const server = new net.Server();
    const port = await listenZero(server);

    const clientPromise = new Promise<net.Socket>((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('timeout waiting for client'));
        }, 30000)
        server.on('connection', client => {
            server.close();
            clearTimeout(timeout);

            resolve(client);
        });
    })

    return {
        port,
        clientPromise,
    }
}
