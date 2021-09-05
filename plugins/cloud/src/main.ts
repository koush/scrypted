import axios from 'axios';
import { BufferConverter, DeviceProvider, HttpRequest, OauthClient, ScryptedDeviceBase, ScryptedInterface, ScryptedMimeTypes, Setting, Settings } from '@scrypted/sdk';
import qs from 'query-string';
import { GcmRtcManager, GcmRtcConnection } from './legacy';
import { Duplex } from 'stream';
import net from 'net';
import tls from 'tls';
import HttpProxy from 'http-proxy';
import { Server, createServer } from 'http';
import Url from 'url';
import sdk from "@scrypted/sdk";
import { once } from 'events';

const {deviceManager, endpointManager } = sdk;

export const DEFAULT_SENDER_ID = '827888101440';

export async function createDefaultRtcManager(): Promise<GcmRtcManager> {
    const manager = await GcmRtcManager.start({
        // Scrypted
        '827888101440': '',
    },
        {
            iceServers: [
                {
                    urls: ["turn:turn0.clockworkmod.com", "turn:n0.clockworkmod.com", "turn:n1.clockworkmod.com"],
                    username: "foo",
                    credential: "bar",
                },
            ],
        });

    return manager;
}

async function whitelist(localUrl: string, ttl: number, baseUrl: string): Promise<Buffer | string> {
    const local = Url.parse(localUrl);
    const token_info = localStorage.getItem('token_info');
    const q = qs.stringify({
        scope: local.path,
        ttl,
    })
    const scope = await axios(`https://home.scrypted.app/_punch/scope?${q}`, {
        headers: {
            Authorization: `Bearer ${token_info}`
        },
    })

    const { userToken, userTokenSignature } = scope.data;
    const tokens = qs.stringify({
        user_token: userToken,
        user_token_signature: userTokenSignature
    })

    const url = `${baseUrl}${local.path}?${tokens}`;
    return url;
}

class ScryptedPush extends ScryptedDeviceBase implements BufferConverter {
    constructor() {
        super('push');

        this.fromMimeType = ScryptedMimeTypes.PushEndpoint;
        this.toMimeType = ScryptedMimeTypes.Url;
    }


    async convert(data: Buffer | string, fromMimeType: string): Promise<Buffer | string> {
        const url = `http://localhost/push/${data}`;
        return whitelist(url, 10 * 365 * 24 * 60 * 60 * 1000, 'https://home.scrypted.app/_punch/cloudmessage');
    }
}

class ScryptedCloud extends ScryptedDeviceBase implements OauthClient, Settings, BufferConverter, DeviceProvider {
    manager: GcmRtcManager;
    server: Server;
    proxy: HttpProxy;
    push: ScryptedPush;

    constructor() {
        super();

        this.initialize();

        this.fromMimeType = `${ScryptedMimeTypes.LocalUrl};${ScryptedMimeTypes.AcceptUrlParameter}=true`;
        this.toMimeType = ScryptedMimeTypes.Url;

        (async () => {
            await deviceManager.onDeviceDiscovered(
                {
                    name: 'Cloud Push Endpoint',
                    nativeId: 'push',
                    interfaces: [ScryptedInterface.BufferConverter],
                },
            );
            this.push = new ScryptedPush();
        })();
    }

    async discoverDevices(duration: number) {
    }
    getDevice(nativeId: string) {
        return this.push;
    }

    async convert(data: Buffer | string, fromMimeType: string): Promise<Buffer | string> {
        return whitelist(data.toString(), 10 * 365 * 24 * 60 * 60 * 1000, 'https://home.scrypted.app');
    }

    async getSettings(): Promise<Setting[]> {
        return [
            {
                title: 'Refresh Token',
                value: this.storage.getItem('token_info'),
                description: 'Authorization token used by Scrypted Cloud.',
                readonly: true,
            }
        ]
    }
    async putSetting(key: string, value: string | number | boolean) {
    }

    async getOauthUrl(): Promise<string> {
        const args = qs.stringify({
            registration_id: this.manager.registrationId,
            sender_id: DEFAULT_SENDER_ID,
        })
        return `https://home.scrypted.app/_punch/login?${args}`
    }

    async onOauthCallback(callbackUrl: string) {
    }

    async initialize() {
        this.server = createServer((req, res) => {
            const url = Url.parse(req.url);
            if (url.path.startsWith('/web/oauth/callback') && url.query) {
                const query = qs.parse(url.query);
                if (!query.callback_url && query.token_info && query.user_info) {
                    localStorage.setItem('token_info', query.token_info as string)
                    res.setHeader('Location', 'https://home.scrypted.app/endpoint/@scrypted/core/public/');
                    res.writeHead(302);
                    res.end();
                    return;
                }
            }
            else if (url.path === '/web/') {
                res.setHeader('Location', 'https://home.scrypted.app/endpoint/@scrypted/core/public/');
                res.writeHead(302);
                res.end();
                return;
            }
            else if (url.path === '/web/component/home/endpoint') {
                this.proxy.web(req, res, {
                    target: 'https://localhost:9443/endpoint/@scrypted/google-home/public/',
                    ignorePath: true,
                    secure: false,
                });
                return;
            }

            this.proxy.web(req, res, undefined, (err) => console.error(err));
        });

        this.server.on('upgrade', (req, socket, head) => {
            this.proxy.ws(req, socket, head, { target: 'wss://localhost:9443', ws: true, secure: false });
        })

        // this.server = net.createServer(conn => console.log('connectionz')) as any;

        // listen(0) does not work in a cluster!!!
        // https://nodejs.org/api/cluster.html#cluster_how_it_works
        // server.listen(0) Normally, this will cause servers to listen on a random port.
        // However, in a cluster, each worker will receive the same "random" port each time they
        // do listen(0). In essence, the port is random the first time, but predictable thereafter.
        // To listen on a unique port, generate a port number based on the cluster worker ID.
        this.server.listen(10081 + Math.round(Math.random() * 10000), '127.0.0.1');

        await once(this.server, 'listening');
        const port = (this.server.address() as any).port;

        this.proxy = HttpProxy.createProxy({
            target: `https://localhost:9443`,
            secure: false,
        });
        this.proxy.on('error', () => { })

        this.manager = await createDefaultRtcManager();
        this.manager.on('unhandled', message => {
            if (message.type !== 'cloudmessage')
                return;
            try {
                const payload = JSON.parse(message.request) as HttpRequest;
                if (!payload.rootPath?.startsWith('/push/'))
                    return;
                const endpoint = payload.rootPath.replace('/push/', '');
                payload.rootPath = '/';
                endpointManager.deliverPush(endpoint, payload)
            }
            catch (e) {
                this.console.error('cloudmessage error', e);
            }
        });
        this.manager.listen("http://localhost", (conn: GcmRtcConnection) => {
            conn.on('socket', async (command: string, socket: Duplex) => {
                let local: any;

                await new Promise(resolve => process.nextTick(resolve));

                if (true) {
                    local = net.connect({
                        port,
                        host: '127.0.0.1',
                    });
                    await new Promise(resolve => process.nextTick(resolve));
                }
                else {
                    local = tls.connect({
                        port: 9443,
                        host: '127.0.0.1',
                        rejectUnauthorized: false,
                    })
                }

                socket.pipe(local).pipe(socket);
            });
        })
    }
}

export default new ScryptedCloud();
