import sdk, { BufferConverter, DeviceProvider, HttpRequest, HttpRequestHandler, HttpResponse, OauthClient, PushHandler, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, Setting, Settings } from "@scrypted/sdk";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import axios from 'axios';
import bpmux from 'bpmux';
import crypto from 'crypto';
import { once } from 'events';
import http from 'http';
import https from 'https';
import HttpProxy from 'http-proxy';
import upnp from 'nat-upnp';
import net from 'net';
import os from 'os';
import path from 'path';
import qs from 'query-string';
import { Duplex } from 'stream';
import Url from 'url';
import type { CORSControlLegacy } from '../../../server/src/services/cors';
import { createSelfSignedCertificate } from '../../../server/src/cert';
import { PushManager } from './push';
import tls from 'tls';

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

        const url = `http://127.0.0.1/push/${data}`;
        return this.cloud.whitelist(url, 10 * 365 * 24 * 60 * 60 * 1000, `https://${this.cloud.getHostname()}${SCRYPTED_CLOUD_MESSAGE_PATH}`);
    }
}

class ScryptedCloud extends ScryptedDeviceBase implements OauthClient, Settings, BufferConverter, DeviceProvider, HttpRequestHandler {
    manager = new PushManager(DEFAULT_SENDER_ID);
    server: http.Server;
    secureServer: https.Server;
    proxy: HttpProxy;
    push: ScryptedPush;
    whitelisted = new Map<string, string>();
    storageSettings = new StorageSettings(this, {
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
        forwardingMode: {
            title: "Port Forwarding Mode",
            description: "The port forwarding mode used to expose the HTTPS port. If port forwarding is disabled or unavailable, Scrypted Cloud will fall back to push to initiate connections with this Scrypted server. Port Forwarding and UPNP are optional but will significantly speed up cloud connections.",
            choices: [
                "UPNP",
                "Router Forward",
                "Disabled",
            ],
            defaultValue: 'UPNP',
        },
        securePort: {
            title: 'Local HTTPS Port',
            description: 'The Scrypted Cloud plugin listens on this port for for cloud connections. The router must use UPNP or port forwarding rules to send requests to this port.',
            type: 'number',
        },
        upnpPort: {
            title: 'External HTTPS Port',
            type: 'number',
        },
        upnpStatus: {
            title: 'UPNP Status',
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
        certificate: {
            hide: true,
            json: true,
        },
        hostname: {
            title: 'Custom Domain (Optional)',
            description: 'Optional/Recommended: The custom domain (hostname) to reach this Scrypted server on https port 443. This will bypass usage of Scrypted Cloud when possible. You will need to set up SSL termination.',
            placeholder: 'my-server.dyndns.com',
            onPut: () => {
                this.updatePortForward(this.storageSettings.values.upnpPort);
            },
        },
    });
    upnpInterval: NodeJS.Timeout;
    upnpClient = upnp.createClient();
    upnpStatus = 'Starting';
    securePort: number;

    constructor() {
        super();

        this.storageSettings.settings.upnpStatus.onGet = async () => {
            return {
                hide: this.storageSettings.values.forwardingMode !== 'UPNP',
            }
        };

        this.storageSettings.settings.upnpPort.onGet = async () => {
            if (this.storageSettings.values.forwardingMode === 'Router Forward') {
                return {
                    description: 'The external port to forward through your router.',
                }
            }
            else if (this.storageSettings.values.forwardingMode === 'UPNP') {
                return {
                    description: 'The external port that will be reserved by UPNP on your router.',
                }
            }
            return {
                hide: true,
            }
        };

        this.storageSettings.settings.securePort.onGet = async () => {
            return {
                hide: this.storageSettings.values.forwardingMode === 'Disabled',
            }
        };

        this.log.clearAlerts();

        this.storageSettings.settings.securePort.onPut =
            this.storageSettings.settings.forwardingMode.onPut =
            this.storageSettings.settings.upnpPort.onPut = (ov, nv) => {
                if (ov && ov !== nv)
                    this.log.a('Reload the Scrypted Cloud Plugin to apply the port change.');
            };

        this.fromMimeType = ScryptedMimeTypes.LocalUrl;
        this.toMimeType = ScryptedMimeTypes.Url;

        if (!this.storageSettings.values.certificate)
            this.storageSettings.values.certificate = createSelfSignedCertificate();

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
    }

    async updatePortForward(upnpPort: number) {
        this.storageSettings.values.upnpPort = upnpPort;

        let ip = this.storageSettings.values.hostname?.toString();

        if (!ip) {
            const response = await axios('https://jsonip.com');
            ip = response.data.ip;
        }

        this.console.log(`Mapped port https://127.0.0.1:${this.securePort} to https://${ip}:${upnpPort}`);

        // the ip is not sent, but should be checked to see if it changed.
        if (this.storageSettings.values.lastPersistedUpnpPort !== upnpPort || ip !== this.storageSettings.values.lastPersistedIp) {
            this.console.log('Registering UPNP IP and Port', ip, upnpPort);

            const registrationId = await this.manager.registrationId;
            const data = await this.sendRegistrationId(registrationId, upnpPort);
            if (this.storageSettings.values.hostname && ip !== data.ip_address) {
                this.log.a(`Scrypted Cloud could not verify the IP Address of your custom domain ${this.storageSettings.values.hostname}.`);
            }
            this.storageSettings.values.lastPersistedUpnpPort = upnpPort;
            this.storageSettings.values.lastPersistedIp = ip;
        }
    }

    async refreshPortForward() {
        if (this.storageSettings.values.forwardingMode === 'Disabled') {
            this.updatePortForward(0);
            return;
        }

        let { upnpPort } = this.storageSettings.values;
        if (!upnpPort)
            upnpPort = Math.round(Math.random() * 30000 + 20000);

        if (this.storageSettings.values.forwardingMode === 'Router Forward')
            return this.updatePortForward(upnpPort);

        if (upnpPort === 443) {
            this.upnpStatus = 'Error: Port 443 Not Allowed';
            const err = 'Scrypted Cloud does not allow reserving port 443 with UPNP. Set up a manual port forward if this is intended.';
            this.log.a(err);
            this.console.error(err);
            this.onDeviceEvent(ScryptedInterface.Settings, undefined);
            return;
        }

        const [localAddress] = await endpointManager.getLocalAddresses();
        this.upnpClient.portMapping({
            public: {
                port: upnpPort,
            },
            private: {
                host: localAddress,
                port: this.securePort,
            },
            ttl: 1800,
        }, async err => {

            this.upnpClient.getMappings(function (err, results) {
                console.log('current upnp mappings', results);
            });

            if (err) {
                this.console.error('UPNP failed', err);
                this.upnpStatus = 'Error: See Console';
                this.onDeviceEvent(ScryptedInterface.Settings, undefined);
                this.log.a('UPNP Port Reservation failed. Enable UPNP on your router, set up port forwarding, or disable Port Forwarding Mode in the Scrypted Cloud Plugin to suppress this error.');
                return;
            }

            this.upnpStatus = 'Active';
            this.onDeviceEvent(ScryptedInterface.Settings, undefined);

            await this.updatePortForward(upnpPort);
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

    async sendRegistrationId(registration_id: string, upnp_port?: number) {
        const registration_secret = this.storageSettings.values.registrationSecret || crypto.randomBytes(8).toString('base64');
        const q = qs.stringify({
            upnp_port: upnp_port || this.storageSettings.values.lastPersistedUpnpPort,
            registration_id,
            sender_id: DEFAULT_SENDER_ID,
            registration_secret,
            hostname: this.storageSettings.values.hostname,
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
        return response.data;
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
        // TODO: 1/25/2023 change this to getInsecurePublicLocalEndpoint to avoid double crypto
        const ep = await endpointManager.getPublicLocalEndpoint();
        const httpTarget = new URL(ep);
        httpTarget.hostname = '127.0.0.1';
        httpTarget.pathname = '';
        const wsTarget = new URL(httpTarget);
        wsTarget.protocol = 'ws';
        const googleHomeTarget = new URL(httpTarget);
        googleHomeTarget.pathname = '/endpoint/@scrypted/google-home/public/';
        const alexaTarget = new URL(httpTarget);
        alexaTarget.pathname = '/endpoint/@scrypted/alexa/public/';

        const headers = {
            'X-Forwarded-Proto': 'https',
        };

        const handler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
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

            this.proxy.web(req, res, { headers }, (err) => console.error(err));
        }

        const wsHandler = (req: http.IncomingMessage, socket: Duplex, head: Buffer) => this.proxy.ws(req, socket, head, { target: wsTarget.toString(), ws: true, secure: false, headers }, (err) => console.error(err));

        this.server = http.createServer(handler);
        this.server.on('upgrade', wsHandler);
        // this can be localhost because this is a server initiated loopback proxy through bpmux
        this.server.listen(0, '127.0.0.1');
        await once(this.server, 'listening');
        const port = (this.server.address() as any).port;

        this.secureServer = https.createServer({
            key: this.storageSettings.values.certificate.serviceKey,
            cert: this.storageSettings.values.certificate.certificate,
        }, handler);
        this.secureServer.on('upgrade', wsHandler)
        // this is the direct connection port
        this.secureServer.listen(this.storageSettings.values.securePort, '0.0.0.0');
        await once(this.secureServer, 'listening');
        this.storageSettings.values.securePort = this.securePort = (this.secureServer.address() as any).port;

        this.upnpInterval = setInterval(() => this.refreshPortForward(), 30 * 60 * 1000);
        this.refreshPortForward();

        this.proxy = HttpProxy.createProxy({
            target: httpTarget,
            secure: false,
        });
        this.proxy.on('error', () => { });
        this.proxy.on('proxyRes', (res, req) => {
            res.headers['X-Scrypted-Cloud'] = 'true';
            res.headers['X-Scrypted-Direct-Address'] = req.headers['x-scrypted-direct-address'];
            res.headers['Access-Control-Expose-Headers'] = 'X-Scrypted-Cloud, X-Scrypted-Direct-Address';
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
                const client = tls.connect(4001, SCRYPTED_SERVER, {
                    rejectUnauthorized: false,
                });
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
