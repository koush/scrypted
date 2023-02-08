import { connectScryptedClient, } from "@scrypted/client";
import { Settings } from "@scrypted/types";
import https from 'https';
import ciao from '@homebridge/ciao';
import type { MdnsServiceRecord } from './mdns-service-record';
import net from 'net';
import { once } from "events";

async function listenZero(server: net.Server) {
    server.listen(0);
    await once(server, 'listening');
    return (server.address() as net.AddressInfo).port;
}

async function listenZeroSingleClient() {
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

    clientPromise.catch(() => { });

    return {
        server,
        url: `tcp://127.0.0.1:${port}`,
        host: '127.0.0.1',
        port,
        clientPromise,
    }
}

const responder = ciao.getResponder();

const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
});

async function main() {
    const pluginId = '@scrypted/docker-mdns';
    const client = await connectScryptedClient({
        username: process.env.SCRYPTED_USERNAME,
        password: process.env.SCRYPTED_PASSWORD,
        baseUrl: 'https://localhost:10443',
        pluginId,
        axiosConfig: {
            httpsAgent,
        }
    });

    const plugin = client.systemManager.getDeviceByName<Settings>(pluginId);
    const settings = await plugin.getSettings();
    const rawServiceRecords: {
        [name: string]: MdnsServiceRecord;
    } = JSON.parse(settings.find(s => s.key === 'rawServiceRecords').value.toString());
    console.log('got rawServiceRecords', rawServiceRecords);

    for (const name in rawServiceRecords) {
        const record = rawServiceRecords[name];
        const txt: { [k: string]: string } = {};
        for (const t of record.txt) {
            const i = t.indexOf('=');
            const k = t.substring(0, i);
            const v = t.substr(i + 1);
            txt[k] = v;
        }

        const server = net.createServer(async client => {
            try {
                const { port, clientPromise } = await listenZeroSingleClient();
                const value = `${record.srv.port}:${port}`;
                await plugin.putSetting('callback', value);
                const remote = await clientPromise;
                remote.pipe(client).pipe(remote);
                client.on('error', () => remote.destroy());
                remote.on('error', () => client.destroy());
            }
            catch (e) {
                client.destroy();
            }
        });
        const port = await listenZero(server);

        const type = record.type.substring(1, record.type.length - '_tcp.local'.length - 1);
        responder.createService({
            name: name.substring(0, name.length - '_hap._tcp.local'.length - 1),
            txt,
            type,
            port,
        })
            .advertise();
    }
}

main();
