import axios from 'axios';
import { BufferConverter, DeviceProvider, HttpRequest, HttpRequestHandler, HttpResponse, OauthClient, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, Setting, Settings } from '@scrypted/sdk';
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
import path from 'path';

const { deviceManager, endpointManager } = sdk;

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

const SCRYPTED_CLOUD_MESSAGE_PATH = '/_punch/cloudmessage';

class ScryptedPush extends ScryptedDeviceBase implements BufferConverter {
    constructor(public cloud: ScryptedCloud) {
        super('push');

        this.fromMimeType = ScryptedMimeTypes.PushEndpoint;
        this.toMimeType = ScryptedMimeTypes.Url;
    }


    async convert(data: Buffer | string, fromMimeType: string): Promise<Buffer | string> {
        if (this.cloud.storage.getItem('hostname')) {
            return `https://${this.cloud.getHostname()}${await this.cloud.getCloudMessagePath()}/${data}`;
        }

        const url = `http://localhost/push/${data}`;
        return this.cloud.whitelist(url, 10 * 365 * 24 * 60 * 60 * 1000, `https://${this.cloud.getHostname()}${SCRYPTED_CLOUD_MESSAGE_PATH}`);
    }
}

class ScryptedCloud extends ScryptedDeviceBase implements OauthClient, Settings, BufferConverter, DeviceProvider, HttpRequestHandler {
    manager: GcmRtcManager;
    server: Server;
    proxy: HttpProxy;
    push: ScryptedPush;
    cloudMessagePath: Promise<string>;

    async whitelist(localUrl: string, ttl: number, baseUrl: string): Promise<Buffer | string> {
        const local = Url.parse(localUrl);

        if (this.storage.getItem('hostname')) {
            return `${baseUrl}${local.path}`;
        }

        const token_info = this.storage.getItem('token_info');
        const q = qs.stringify({
            scope: local.path,
            ttl,
        })
        const scope = await axios(`https://${this.getHostname()}/_punch/scope?${q}`, {
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


    constructor() {
        super();

        this.initialize();

        this.fromMimeType = `${ScryptedMimeTypes.LocalUrl};${ScryptedMimeTypes.AcceptUrlParameter}=true`;
        this.toMimeType = ScryptedMimeTypes.Url;

        (async () => {
            await deviceManager.onDeviceDiscovered(
                {
                    name: 'Cloud Push Endpoint',
                    type: ScryptedDeviceType.API,
                    nativeId: 'push',
                    interfaces: [ScryptedInterface.BufferConverter],
                },
            );
            this.push = new ScryptedPush(this);
        })();
    }

    async onRequest(request: HttpRequest, response: HttpResponse): Promise<void> {
        response.send('ok');

        const cm = await this.getCloudMessagePath();
        const { url } = request;
        if (url.startsWith(cm)) {
            const endpoint = url.substring(cm.length + 1);
            request.rootPath = '/';
            endpointManager.deliverPush(endpoint, request);
        }
    }

    async discoverDevices(duration: number) {
    }

    getDevice(nativeId: string) {
        return this.push;
    }

    getHostname() {
        const hostname = this.storage.getItem('hostname') || 'home.scrypted.app';
        return hostname;
    }

    async convert(data: Buffer | string, fromMimeType: string): Promise<Buffer | string> {
        return this.whitelist(data.toString(), 10 * 365 * 24 * 60 * 60 * 1000, `https://${this.getHostname()}`);
    }

    async getSettings(): Promise<Setting[]> {
        return [
            {
                title: 'Hostname',
                key: 'hostname',
                value: this.storage.getItem('hostname'),
                description: 'Optional/Recommended: The hostname to reach this Scrypted server on https port 443. This will bypass usage of Scrypted cloud when possible. You will need to set up SSL termination.',
                placeholder: 'my-server.dyndns.com'
            },
            // {
            //     title: 'Refresh Token',
            //     value: this.storage.getItem('token_info'),
            //     description: 'Authorization token used by Scrypted Cloud.',
            //     readonly: true,
            // },
        ];
    }

    async putSetting(key: string, value: string | number | boolean) {
        this.storage.setItem(key, value.toString());
        this.cloudMessagePath = undefined;
    }

    async getCloudMessagePath() {
        if (!this.cloudMessagePath) {
            this.cloudMessagePath = (async () => {
                const url = new URL(await endpointManager.getPublicLocalEndpoint());
                return path.join(url.pathname, 'cloudmessage');
            })()
        }
        return this.cloudMessagePath;
    }

    async getOauthUrl(): Promise<string> {
        const args = qs.stringify({
            registration_id: this.manager.registrationId,
            sender_id: DEFAULT_SENDER_ID,
        })
        return `https://home.scrypted.app/_punch/login?${args}`;
        // this is disabled because we can't assume that custom domains will implement this oauth endpoint.
        // return `https://${this.getHostname()}/_punch/login?${args}`
    }

    async onOauthCallback(callbackUrl: string) {
    }

    async initialize() {
        const ep = await endpointManager.getPublicLocalEndpoint();
        const httpsTarget = new URL(ep);
        httpsTarget.hostname = 'localhost';
        httpsTarget.pathname = '';
        const wssTarget = new URL(httpsTarget);
        wssTarget.protocol = 'wss';
        const googleHomeTarget = new URL(httpsTarget);
        googleHomeTarget.pathname = '/endpoint/@scrypted/google-home/public/';

        this.server = createServer(async (req, res) => {
            const url = Url.parse(req.url);
            if (url.path.startsWith('/web/oauth/callback') && url.query) {
                const query = qs.parse(url.query);
                if (!query.callback_url && query.token_info && query.user_info) {
                    this.storage.setItem('token_info', query.token_info as string)
                    res.setHeader('Location', `https://${this.getHostname()}/endpoint/@scrypted/core/public/`);
                    res.writeHead(302);
                    res.end();
                    return;
                }
            }

            else if (url.path === '/web/') {
                res.setHeader('Location', `https://${this.getHostname()}/endpoint/@scrypted/core/public/`);
                res.writeHead(302);
                res.end();
                return;
            }
            else if (url.path === '/web/component/home/endpoint') {
                this.proxy.web(req, res, {
                    target: googleHomeTarget.toString(),
                    ignorePath: true,
                    secure: false,
                });
                return;
            }

            this.proxy.web(req, res, undefined, (err) => console.error(err));
        });

        this.server.on('upgrade', (req, socket, head) => {
            this.proxy.ws(req, socket, head, { target: wssTarget.toString(), ws: true, secure: false });
        })

        this.server.listen(0, '127.0.0.1');

        await once(this.server, 'listening');
        const port = (this.server.address() as any).port;

        this.proxy = HttpProxy.createProxy({
            target: httpsTarget,
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

                local = net.connect({
                    port,
                    host: '127.0.0.1',
                });
                await new Promise(resolve => process.nextTick(resolve));

                socket.pipe(local).pipe(socket);
            });
        })
    }
}

export default new ScryptedCloud();
