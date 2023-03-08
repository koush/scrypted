import { once } from 'events';
import net from 'net';

export async function listenZero(server: net.Server, hostname?: string) {
    server.listen(0, hostname);
    await once(server, 'listening');
    return (server.address() as net.AddressInfo).port;
}

export async function listenZeroSingleClient(hostname?: string) {
    const server = new net.Server();
    const port = await listenZero(server, hostname);

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

    clientPromise.catch(() => { });

    let host = hostname;
    if (!host || host === '0.0.0.0')
        host = '127.0.0.1';

    return {
        server,
        url: `tcp://${host}:${port}`,
        host,
        port,
        clientPromise,
    }
}
