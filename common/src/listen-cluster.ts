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