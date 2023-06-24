import { once } from 'events';
import net from 'net';

export class ListenZeroSingleClientTimeoutError extends Error {
    constructor() {
        super('timeout waiting for client')
    }
}

export async function listenZero(server: net.Server, hostname?: string) {
    server.listen(0, hostname);
    await once(server, 'listening');
    return (server.address() as net.AddressInfo).port;
}

export async function listenZeroSingleClient(hostname?: string) {
    const server = new net.Server();
    const port = await listenZero(server, hostname);

    let cancel: () => void;
    const clientPromise = new Promise<net.Socket>((resolve, reject) => {
        const timeout = setTimeout(() => {
            server.close();
            reject(new ListenZeroSingleClientTimeoutError());
        }, 30000);
        cancel = () => {
            clearTimeout(timeout);
            server.close();
        };
        server.on('connection', client => {
            cancel();
            resolve(client);
        });
    });

    clientPromise.catch(() => { });

    let host = hostname;
    if (!host || host === '0.0.0.0')
        host = '127.0.0.1';

    return {
        server,
        cancel,
        url: `tcp://${host}:${port}`,
        host,
        port,
        clientPromise,
    }
}
