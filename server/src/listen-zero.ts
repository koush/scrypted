import { once } from 'events';
import net from 'net';

export async function listenZero(server: net.Server) {
    server.listen(0);
    await once(server, 'listening');
    return (server.address() as net.AddressInfo).port;
}

export async function listenZeroSingleClient() {
    const server = new net.Server();
    const port = await listenZero(server);

    const clientPromise = new Promise<net.Socket>((resolve, reject) => {
        const timeout = setTimeout(() => {
            server.close();
            reject(new Error('timeout waiting for client'));
        }, 30000)
        server.on('connection', client => {
            server.close();
            clearTimeout(timeout);

            resolve(client);
        });
    });

    clientPromise.catch(() => {});

    return {
        server,
        url: `tcp://127.0.0.1:${port}`,
        host: '127.0.0.1',
        port,
        clientPromise,
    }
}
