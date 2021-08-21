import net, { AddressInfo } from 'net';
import { once } from 'events';

export async function listenZeroCluster(server: net.Server) {
    while (true) {
        const port = 10000 + Math.round(Math.random() * 30000);
        server.listen(port);
        try {
            await once(server, 'listening');
            return (server.address() as AddressInfo).port;
        }
        catch (e) {
        }
    }
}
