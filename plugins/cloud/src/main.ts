import sdk, { BufferConverter, DeviceProvider, HttpRequest, HttpRequestHandler, HttpResponse, OauthClient, PushHandler, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, Setting, Settings } from "@scrypted/sdk";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import axios from 'axios';
import bpmux from 'bpmux';
import crypto from 'crypto';
import { once } from 'events';
import { createServer, Server } from 'http';
import HttpProxy from 'http-proxy';
import upnp from 'nat-upnp';
import net from 'net';
import os from 'os';
import path from 'path';
import qs from 'query-string';
import { Duplex } from 'stream';
import Url from 'url';
import type { CORSControl, CORSControlLegacy } from '../../../server/src/services/cors';
import { PushManager } from './push';

const { deviceManager, endpointManager, systemManager } = sdk;

export const DEFAULT_SENDER_ID = '827888101440';
const SCRYPTED_SERVER = 'home.scrypted.app';

const SCRYPTED_CLOUD_MESSAGE_PATH = '/_punch/cloudmessage';

class ScryptedPush extends ScryptedDeviceBase implements BufferConverter {
    constructor(public cloud: ScryptedCloud) {
        super('push');

        this.fromMimeType = ScryptedMimeTypes.PushEndpoint;
        this.toMimeType = ScryptedMimeTypes.Url;
    }


    async convert(data: Buffer | string, fromMimeType: string): Promise<Buffer> {
        if (this.cloud.storageSettings.values.hostname) {
            return Buffer.from(`https://${this.cloud.getHostname()}${await this.cloud.getCloudMessagePath()}/${data}`);
        }

        const url = `http://localhost/push/${data}`;
        return this.cloud.whitelist(url, 10 * 365 * 24 * 60 * 60 * 1000, `https://${this.cloud.getHostname()}${SCRYPTED_CLOUD_MESSAGE_PATH}`);
    }
}

class ScryptedCloud extends ScryptedDeviceBase implements OauthClient, Settings, BufferConverter, DeviceProvider, HttpRequestHandler {
    manager = new PushManager(DEFAULT_SENDER_ID);
    server: Server;
    proxy: HttpProxy;
    push: ScryptedPush;
    whitelisted = new Map<string, string>();
    storageSettings = new StorageSettings(this, {
        hostname: {
            title: 'Hostname (Custom Domain)',
            description: 'Optional/Recommended: The hostname to reach this Scrypted server on https port 443. This will bypass usage of Scrypted cloud when possible. You will need to set up SSL termination.',
            placeholder: 'my-server.dyndns.com'
        },
        token_info: {
            hide: true,
        },
        lastPersistedRegistrationId: {
            hide: true,
        },
        registrationSecret: {
            hide: true,
        },
        cloudMessageToken: {
            hide: true,
            persistedDefaultValue: crypto.randomBytes(8).toString('hex'),
        },
        upnpPort: {
            title: 'UPNP Port (Optional)',
            description: 'The external port to reserve for UPNP NAT. UPNP must be enabled on your router.',
            type: 'number',
        },
        upnpStatus: {
            title: 'UPNP Status (Optional)',
            description: 'The status of the UPNP NAT reservation.',
            readonly: true,
            mapGet: () => {
                return this.upnpStatus;
            },
        },
        lastPersistedUpnpPort: {
            hide: true,
            type: 'number',
        },
        lastPersistedIp: {
            hide: true,
        },
    });
    upnpInterval: NodeJS.Timeout;
    upnpClient = upnp.createClient();
    upnpStatus = 'Starting';

    constructor() {
        super();

        this.fromMimeType = ScryptedMimeTypes.LocalUrl;
        this.toMimeType = ScryptedMimeTypes.Url;

        this.setupProxyServer();
        this.setupCloudPush();

        this.manager.on('registrationId', async (registrationId) => {
            // currently the fcm registration id never changes, so, there's no need.
            // if ever adding clockwork push, uncomment this.
            this.sendRegistrationId(registrationId);
        });

        this.manager.registrationId.then(async registrationId => {
            if (this.storageSettings.values.lastPersistedRegistrationId !== registrationId || !this.storageSettings.values.registrationSecret)
                this.sendRegistrationId(registrationId);
        })

        this.updateCors();

        // this.upnpInterval = setInterval(this.refreshUpnp, 30 * 60 * 1000);
        // this.refreshUpnp();
    }

    async refreshUpnp() {
        if (this.storageSettings.values.hostname) {
            this.upnpStatus = 'Disabled: Using Custom Domain';
            this.onDeviceEvent(ScryptedInterface.Settings, undefined);
            return;
        }

        let { upnpPort } = this.storageSettings.values;
        if (!upnpPort)
            upnpPort = Math.round(Math.random() * 30000 + 20000);
        const [localAddress] = await endpointManager.getLocalAddresses();
        this.upnpClient.portMapping({
            public: {
                port: upnpPort,
            },
            private: {
                host: localAddress,
                port: 10443,
            },
            ttl: 1800,
        }, async err => {
            if (err) {
                this.console.error('UPNP failed', err);
                this.upnpStatus = 'Error: See Console';
                this.onDeviceEvent(ScryptedInterface.Settings, undefined);
                return;
            }

            this.upnpStatus = 'Active';
            this.onDeviceEvent(ScryptedInterface.Settings, undefined);
            this.storageSettings.values.upnpPort = upnpPort;

            const response = await axios('https://jsonip.com');
            const { ip } = response.data;
            this.console.log('External IP:', ip);

            // the ip is not sent, but should be checked to see if it changed.
            if (this.storageSettings.values.lastPersistedUpnpPort !== upnpPort || ip !== this.storageSettings.values.lastPersistedIp) {
                this.console.log('Registering UPNP IP and Port', ip, upnpPort);

                const registrationId = await this.manager.registrationId;
                await this.sendRegistrationId(registrationId, upnpPort);
                this.storageSettings.values.lastPersistedUpnpPort = upnpPort;
                this.storageSettings.values.lastPersistedIp = ip;
            }
        });
    }

    async whitelist(localUrl: string, ttl: number, baseUrl: string): Promise<Buffer> {
        const local = Url.parse(localUrl);

        if (this.storageSettings.values.hostname) {
            return Buffer.from(`${baseUrl}${local.path}`);
        }

        if (this.whitelisted.has(local.path)) {
            return Buffer.from(this.whitelisted.get(local.path));
        }

        const { token_info } = this.storageSettings.values;
        if (!token_info)
            throw new Error('@scrypted/cloud is not logged in.');
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
        this.whitelisted.set(local.path, url);
        return Buffer.from(url);
    }


    async updateCors() {
        try {
            if (endpointManager.setAccessControlAllowOrigin) {
                endpointManager.setAccessControlAllowOrigin({
                    origins: [
                        'http://home.scrypted.app',
                        'https://home.scrypted.app',
                    ],
                });
            }
            else {
                // TODO: delete this
                // 1/25/2023
                const corsControl = await systemManager.getComponent('cors') as CORSControlLegacy;
                let cors = await corsControl.getCORS();
                cors = cors.filter(entry => entry.tag !== '@scrypted/cloud');
                cors.push(
                    {
                        tag: '@scrypted/cloud',
                        server: 'https://home.scrypted.app',
                    },
                    {
                        tag: '@scrypted/cloud',
                        server: 'http://home.scrypted.app',
                    },
                );
                const { hostname } = this.storageSettings.values;
                if (hostname) {
                    cors.push(
                        {
                            tag: '@scrypted/cloud',
                            server: `https://${hostname}`,
                        },
                        {
                            tag: '@scrypted/cloud',
                            server: `http://${hostname}`,
                        },
                    );
                }
                await corsControl.setCORS(cors);
            }
        }
        catch (e) {
            this.console.error('error updating cors, is your scrypted server up to date?', e);
        }
    }

    async sendRegistrationId(registration_id: string, upnp_port?: string) {
        const registration_secret = this.storageSettings.values.registrationSecret || crypto.randomBytes(8).toString('base64');
        const q = qs.stringify({
            upnp_port: upnp_port || this.storageSettings.values.lastPersistedUpnpPort,
            registration_id,
            sender_id: DEFAULT_SENDER_ID,
            registration_secret,
        });

        const { token_info } = this.storageSettings.values;
        const response = await axios(`https://${SCRYPTED_SERVER}/_punch/register?${q}`, {
            headers: {
                Authorization: `Bearer ${token_info}`
            },
        });
        this.console.log('registered', response.data);
        this.storageSettings.values.lastPersistedRegistrationId = registration_id;
        this.storageSettings.values.registrationSecret = registration_secret;
    }

    async setupCloudPush() {
        await deviceManager.onDeviceDiscovered(
            {
                name: 'Cloud Push Endpoint',
                type: ScryptedDeviceType.API,
                nativeId: 'push',
                interfaces: [ScryptedInterface.BufferConverter],
            },
        );
        this.push = new ScryptedPush(this);
    }

    async onRequest(request: HttpRequest, response: HttpResponse): Promise<void> {
        response.send('', {
            headers: {
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Origin': request.headers?.origin,
                'Access-Control-Allow-Headers': 'Content-Type, Authorization, Content-Length, X-Requested-With'
            },
        });

        if (request.method.toLowerCase() === 'options')
            return;

        const cm = await this.getCloudMessagePath();
        const { url } = request;
        if (url.startsWith(cm)) {
            const endpoint = url.substring(cm.length + 1);
            request.rootPath = '/';
            this.deliverPush(endpoint, request);
        }
    }

    async getDevice(nativeId: string) {
        return this.push;
    }

    async releaseDevice(id: string, nativeId: string): Promise<void> {
    }

    getHostname() {
        const hostname = this.storageSettings.values.hostname || SCRYPTED_SERVER;
        return hostname;
    }

    async convert(data: Buffer, fromMimeType: string): Promise<Buffer> {
        return this.whitelist(data.toString(), 10 * 365 * 24 * 60 * 60 * 1000, `https://${this.getHostname()}`);
    }

    async getSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }

    async putSetting(key: string, value: string | number | boolean) {
        this.storageSettings.putSetting(key, value);
        this.updateCors();
    }

    async getCloudMessagePath() {
        const url = new URL(await endpointManager.getPublicLocalEndpoint());
        return path.join(url.pathname, this.storageSettings.values.cloudMessageToken);
    }

    async deliverPush(endpoint: string, request: HttpRequest) {
        const handler = systemManager.getDeviceById<PushHandler>(endpoint);
        if (!handler) {
            this.console.error('device not found for push event to', endpoint);
            return;
        }
        if (!handler.interfaces.includes(ScryptedInterface.PushHandler)) {
            this.console.error('device not a push handler', endpoint);
            return;
        }

        return handler.onPush(request);
    }

    async getOauthUrl(): Promise<string> {
        const args = qs.stringify({
            hostname: os.hostname(),
            registration_id: await this.manager.registrationId,
            sender_id: DEFAULT_SENDER_ID,
        })
        return `https://${SCRYPTED_SERVER}/_punch/login?${args}`;
        // this is disabled because we can't assume that custom domains will implement this oauth endpoint.
        // return `https://${this.getHostname()}/_punch/login?${args}`
    }

    async onOauthCallback(callbackUrl: string) {
    }

    async setupProxyServer() {
        const ep = await endpointManager.getPublicLocalEndpoint();
        const httpsTarget = new URL(ep);
        httpsTarget.hostname = 'localhost';
        httpsTarget.pathname = '';
        const wssTarget = new URL(httpsTarget);
        wssTarget.protocol = 'wss';
        const googleHomeTarget = new URL(httpsTarget);
        googleHomeTarget.pathname = '/endpoint/@scrypted/google-home/public/';
        const alexaTarget = new URL(httpsTarget);
        alexaTarget.pathname = '/endpoint/@scrypted/alexa/public/';

        this.server = createServer(async (req, res) => {
            const url = Url.parse(req.url);
            if (url.path.startsWith('/web/oauth/callback') && url.query) {
                const query = qs.parse(url.query);
                if (!query.callback_url && query.token_info && query.user_info) {
                    this.storageSettings.values.token_info = query.token_info;
                    this.storageSettings.values.lastPersistedRegistrationId = await this.manager.registrationId;
                    res.setHeader('Location', `https://${this.getHostname()}/endpoint/@scrypted/core/public/`);
                    res.writeHead(302);
                    res.end();
                    return;
                }
            }
            else if (url.path === '/web/') {
                if (this.storageSettings.values.hostname)
                    res.setHeader('Location', `https://${this.storageSettings.values.hostname}/endpoint/@scrypted/core/public/`);
                else
                    res.setHeader('Location', '/endpoint/@scrypted/core/public/');
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
            else if (url.path === '/web/component/alexa/endpoint') {
                this.proxy.web(req, res, {
                    target: alexaTarget.toString(),
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
        this.proxy.on('error', () => { });
        this.proxy.on('proxyRes', (res, req) => {
            res.headers['X-Scrypted-Cloud'] = 'true';
            res.headers['Access-Control-Expose-Headers'] = 'X-Scrypted-Cloud';
        });

        let backoff = 0;
        this.manager.on('message', async (message) => {
            if (message.type === 'cloudmessage') {
                try {
                    const payload = JSON.parse(message.request) as HttpRequest;
                    if (!payload.rootPath?.startsWith('/push/'))
                        return;
                    const endpoint = payload.rootPath.replace('/push/', '');
                    payload.rootPath = '/';
                    await this.deliverPush(endpoint, payload);
                }
                catch (e) {
                    this.console.error('cloudmessage error', e);
                }
            }
            else if (message.type === 'callback') {
                // queued push messages will be spammed on startup, ignore them.
                if (Date.now() < backoff + 5000)
                    return;
                backoff = Date.now();
                const random = Math.random().toString(36).substring(2);
                this.console.log('scrypted server requested a connection:', random);
                const client = net.connect(4000, SCRYPTED_SERVER);
                client.on('close', () => this.console.log('scrypted server connection ended:', random));
                const registrationId = await this.manager.registrationId;
                client.write(registrationId + '\n');
                const mux: any = new bpmux.BPMux(client as any);
                mux.on('handshake', async (socket: Duplex) => {
                    let local: any;

                    await new Promise(resolve => process.nextTick(resolve));

                    local = net.connect({
                        port,
                        host: '127.0.0.1',
                    });
                    await new Promise(resolve => process.nextTick(resolve));

                    socket.pipe(local).pipe(socket);
                });
            }
        });
    }
}

export default new ScryptedCloud();
