import net from 'net';
import { once } from 'events';

export async function listenZero(server: net.Server) {
    server.listen(0);
    await once(server, 'listening');
    return (server.address() as net.AddressInfo).port;
}
