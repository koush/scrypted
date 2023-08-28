import sdk, { BufferConverter, DeviceProvider, HttpRequest, HttpRequestHandler, HttpResponse, OauthClient, PushHandler, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, Setting, Settings } from "@scrypted/sdk";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import axios from 'axios';
import bpmux from 'bpmux';
import crypto from 'crypto';
import { once } from 'events';
import http from 'http';
import HttpProxy from 'http-proxy';
import https from 'https';
import upnp from 'nat-upnp';
import net from 'net';
import os from 'os';
import path from 'path';
import { Duplex } from 'stream';
import tls from 'tls';
import { createSelfSignedCertificate } from '../../../server/src/cert';
import { PushManager } from './push';
import { readLine } from '../../../common/src/read-stream';
import { qsparse, qsstringify } from "./qs";
import * as cloudflared from 'cloudflared';
import fs, { mkdirSync } from 'fs';
import { backOff } from "exponential-backoff";
import ip from 'ip';
import { Deferred } from "@scrypted/common/src/deferred";

// import { registerDuckDns } from "./greenlock";

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
        const validDomain = this.cloud.getSSLHostname();
        if (validDomain)
            return Buffer.from(`https://${validDomain}${await this.cloud.getCloudMessagePath()}/${data}`);

        const url = `http://127.0.0.1/push/${data}`;
        return this.cloud.whitelist(url, 10 * 365 * 24 * 60 * 60 * 1000, `https://${this.cloud.getHostname()}${SCRYPTED_CLOUD_MESSAGE_PATH}`);
    }
}

class ScryptedCloud extends ScryptedDeviceBase implements OauthClient, Settings, BufferConverter, DeviceProvider, HttpRequestHandler {
    cloudflareTunnel: string;
    cloudflared: Awaited<ReturnType<typeof cloudflared.tunnel>>;
    manager = new PushManager(DEFAULT_SENDER_ID);
    server: http.Server;
    secureServer: https.Server;
    proxy: HttpProxy;
    push: ScryptedPush;
    whitelisted = new Map<string, string>();
    reregisterTimer: NodeJS.Timeout;
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
                "Custom Domain",
                "Disabled",
            ],
            defaultValue: 'UPNP',
            onPut: () => this.scheduleRefreshPortForward(),
        },
        hostname: {
            title: 'Hostname',
            description: 'The hostname to reach this Scrypted server on https port 443. Requires a valid SSL certificate.',
            placeholder: 'my-server.dyndns.com',
            onPut: () => this.scheduleRefreshPortForward(),
        },
        duckDnsToken: {
            hide: true,
            title: 'Duck DNS Token',
            placeholder: 'xxxxx123456',
            onPut: () => {
                this.storageSettings.values.duckDnsCertValid = false;
                this.log.a('Reload the Scrypted Cloud Plugin to apply the Duck DNS change.');
            }
        },
        duckDnsHostname: {
            hide: true,
            title: 'Duck DNS Hostname',
            placeholder: 'my-scrypted.duckdns.org',
            onPut: () => {
                this.storageSettings.values.duckDnsCertValid = false;
                this.log.a('Reload the Scrypted Cloud Plugin to apply the Duck DNS change.');
            }
        },
        duckDnsCertValid: {
            type: 'boolean',
            hide: true,
        },
        upnpPort: {
            title: 'From Port',
            description: "The external network port on router used by port forwarding.",
            type: 'number',
            onPut: (ov, nv) => {
                if (ov !== nv)
                    this.scheduleRefreshPortForward();
            },
        },
        securePort: {
            title: 'Forward Port',
            description: 'The internal https port used by the Scrypted Cloud plugin. The router must forward connections to this port number on this server\'s internal IP address.',
            type: 'number',
            onPut: (ov, nv) => {
                if (ov && ov !== nv)
                    this.log.a('Reload the Scrypted Cloud Plugin to apply the port change.');
            }
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
        register: {
            group: 'Advanced',
            title: 'Register',
            type: 'button',
            onPut: () => this.manager.registrationId.then(r => this.sendRegistrationId(r)),
            description: 'Register server with Scrypted Cloud.',
        },
        testPortForward: {
            group: 'Advanced',
            title: 'Test Port Forward',
            type: 'button',
            onPut: () => this.testPortForward(),
            description: 'Test the port forward connection from Scrypted Cloud.',
        },
        cloudflaredTunnelToken: {
            group: 'Advanced',
            title: 'Cloudflare Tunnel Token',
            description: 'Optional: Enter the Cloudflare token from the Cloudflare Dashbaord to track and manage the tunnel remotely.',
            onPut: () => {
                this.cloudflared?.child.kill();
            },
        }
    });
    upnpInterval: NodeJS.Timeout;
    upnpClient = upnp.createClient();
    upnpStatus = 'Starting';
    securePort: number;
    randomBytes = crypto.randomBytes(16).toString('base64');
    reverseConnections = new Set<Duplex>();

    constructor() {
        super();

        this.storageSettings.settings.register.onPut = async () => {
            await this.sendRegistrationId(await this.manager.registrationId);
        }

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

        this.storageSettings.settings.hostname.onGet = async () => {
            return {
                hide: this.storageSettings.values.forwardingMode !== 'Custom Domain',
            }
        };

        // this.storageSettings.settings.duckDnsToken.onGet = async () => {
        //     return {
        //         hide: this.storageSettings.values.forwardingMode === 'Custom Domain'
        //             || this.storageSettings.values.forwardingMode === 'Disabled',
        //     }
        // };

        // this.storageSettings.settings.duckDnsHostname.onGet = async () => {
        //     return {
        //         hide: this.storageSettings.values.forwardingMode === 'Custom Domain'
        //             || this.storageSettings.values.forwardingMode === 'Disabled',
        //     }
        // };

        this.log.clearAlerts();

        this.storageSettings.settings.securePort.onPut = (ov, nv) => {
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

        if (!this.storageSettings.values.token_info && process.env.SCRYPTED_CLOUD_TOKEN) {
            this.storageSettings.values.token_info = process.env.SCRYPTED_CLOUD_TOKEN;
            this.manager.registrationId.then(r => this.sendRegistrationId(r));
        }
    }

    scheduleRefreshPortForward() {
        if (this.reregisterTimer)
            return;
        this.reregisterTimer = setTimeout(() => {
            this.reregisterTimer = undefined;
            this.refreshPortForward();
        }, 1000);
    }

    async updatePortForward(upnpPort: number) {
        this.storageSettings.values.upnpPort = upnpPort;

        // scrypted cloud will replace localhost with requesting ip.
        let ip: string;
        if (this.storageSettings.values.forwardingMode === 'Custom Domain') {
            ip = this.storageSettings.values.hostname?.toString();
            if (!ip)
                throw new Error('Hostname is required for port Custom Domain setup.');
        }
        else if (this.storageSettings.values.duckDnsHostname && this.storageSettings.values.duckDnsToken) {
            try {
                const url = new URL('https://www.duckdns.org/update');
                url.searchParams.set('domains', this.storageSettings.values.duckDnsHostname);
                url.searchParams.set('token', this.storageSettings.values.duckDnsToken);
                await axios(url.toString());
            }
            catch (e) {
                this.console.error('Duck DNS Erorr', e);
                throw new Error('Duck DNS Error. See Console Logs.');
            }

            try {
                throw new Error('not implemented');
                // const pems = await registerDuckDns(this.storageSettings.values.duckDnsHostname, this.storageSettings.values.duckDnsToken);
                // this.storageSettings.values.duckDnsCertValid = true;
                // const certificate = this.storageSettings.values.certificate;
                // const chain = pems.cert.trim() + '\n' + pems.chain.trim();
                // if (certificate.certificate !== chain || certificate.serviceKey !== pems.privkey) {
                //     certificate.certificate = chain;
                //     certificate.serviceKey = pems.privkey;
                //     this.storageSettings.values.certificate = certificate;
                //     deviceManager.requestRestart();
                // }
            }
            catch (e) {
                this.console.error("Let's Encrypt Error", e);
                throw new Error("Let's Encrypt Error. See Console Logs.");
            }

            ip = this.storageSettings.values.duckDnsHostname;
        }
        else {
            ip = (await axios(`https://${SCRYPTED_SERVER}/_punch/ip`)).data.ip;
        }

        if (this.storageSettings.values.forwardingMode === 'Custom Domain')
            upnpPort = 443;

        this.console.log(`Scrypted Cloud mapped https://${ip}:${upnpPort} to https://127.0.0.1:${this.securePort}`);

        // the ip is not sent, but should be checked to see if it changed.
        if (this.storageSettings.values.lastPersistedUpnpPort !== upnpPort || ip !== this.storageSettings.values.lastPersistedIp) {
            this.console.log('Registering IP and Port', ip, upnpPort);

            const registrationId = await this.manager.registrationId;
            const data = await this.sendRegistrationId(registrationId);
            if (ip !== 'localhost' && ip !== data.ip_address) {
                this.log.a(`Scrypted Cloud could not verify the IP Address of your custom domain ${this.storageSettings.values.hostname}.`);
            }
            this.storageSettings.values.lastPersistedIp = ip;
        }
    }

    async testPortForward() {
        try {
            const pluginPath = await endpointManager.getPath(undefined, {
                public: true,
            });
            const url = new URL(`https://${SCRYPTED_SERVER}/_punch/curl`);
            let { upnp_port, hostname } = this.getAuthority();
            // scrypted cloud will replace localhost with requesting ip
            if (!hostname)
                hostname = 'localhost';
            url.searchParams.set('url', `https://${hostname}:${upnp_port}${pluginPath}/testPortForward`);
            const response = await axios(url.toString());
            this.console.log('test data:', response.data);
            if (response.data.error)
                throw new Error(response.data.error);
            if (response.data.data !== this.randomBytes)
                throw new Error('Server received data that did not match this server.');
            this.log.a("Port Forward Test Succeeded.");
        }
        catch (e) {
            this.console.error('port forward test failed', e);
            this.log.a(`Port Forward Test Failed: ${e}`);
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

        if (upnpPort === 443) {
            this.upnpStatus = 'Error: Port 443 Not Allowed';
            const err = 'Scrypted Cloud does not allow usage of port 443. Use a custom domain with a SSL terminating reverse proxy.';
            this.log.a(err);
            this.console.error(err);
            this.onDeviceEvent(ScryptedInterface.Settings, undefined);
            return;
        }

        if (this.storageSettings.values.forwardingMode === 'Router Forward')
            return this.updatePortForward(upnpPort);

        if (this.storageSettings.values.forwardingMode === 'Custom Domain')
            return this.updatePortForward(upnpPort);

        const [localAddress] = await endpointManager.getLocalAddresses() || [];
        if (!localAddress) {
            this.log.a('UPNP Port Reservation failed. Scrypted Server Address is not configured in system Settings.');
            return;
        }

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
        const local = new URL(localUrl);

        if (this.getSSLHostname()) {
            return Buffer.from(`${baseUrl}${local.pathname}`);
        }

        if (this.whitelisted.has(local.pathname)) {
            return Buffer.from(this.whitelisted.get(local.pathname));
        }

        const { token_info } = this.storageSettings.values;
        if (!token_info)
            throw new Error('@scrypted/cloud is not logged in.');
        const q = qsstringify({
            scope: local.pathname,
            ttl,
        })
        const scope = await axios(`https://${this.getHostname()}/_punch/scope?${q}`, {
            headers: {
                Authorization: `Bearer ${token_info}`
            },
        })

        const { userToken, userTokenSignature } = scope.data;
        const tokens = qsstringify({
            user_token: userToken,
            user_token_signature: userTokenSignature
        })

        const url = `${baseUrl}${local.pathname}?${tokens}`;
        this.whitelisted.set(local.pathname, url);
        return Buffer.from(url);
    }

    async updateCors() {
        try {
            endpointManager.setAccessControlAllowOrigin({
                origins: [
                    `http://${SCRYPTED_SERVER}`,
                    `https://${SCRYPTED_SERVER}`,
                    // chromecast receiver. move this into google home and chromecast plugins?
                    'https://koush.github.io',
                ],
            });
        }
        catch (e) {
            this.console.error('error updating cors, is your scrypted server up to date?', e);
        }
    }

    getAuthority() {
        const upnp_port = this.storageSettings.values.forwardingMode === 'Custom Domain' ? 443 : this.storageSettings.values.upnpPort;
        const hostname = this.storageSettings.values.forwardingMode === 'Custom Domain'
            ? this.storageSettings.values.hostname
            : this.storageSettings.values.duckDnsToken && this.storageSettings.values.duckDnsHostname;

        if (upnp_port === 443 && !hostname) {
            const error = this.storageSettings.values.forwardingMode === 'Custom Domain'
                ? 'Hostname is required for port Custom Domain setup.'
                : 'Port 443 requires Custom Domain configuration.';
            this.log.a(error);
            throw new Error(error);
        }

        return {
            upnp_port,
            hostname,
        }
    }

    async sendRegistrationId(registration_id: string) {
        const { upnp_port, hostname } = this.getAuthority();
        const registration_secret = this.storageSettings.values.registrationSecret || crypto.randomBytes(8).toString('base64');

        const q = qsstringify({
            upnp_port,
            registration_id,
            sender_id: DEFAULT_SENDER_ID,
            registration_secret,
            hostname,
        });

        const { token_info } = this.storageSettings.values;
        const response = await axios(`https://${SCRYPTED_SERVER}/_punch/register?${q}`, {
            headers: {
                Authorization: `Bearer ${token_info}`
            },
        });
        this.console.log('registered', response.data);
        this.storageSettings.values.lastPersistedRegistrationId = registration_id;
        this.storageSettings.values.lastPersistedUpnpPort = upnp_port;
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
        if (request.url.endsWith('/testPortForward')) {
            response.send(this.randomBytes);
            return;
        }

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

    getSSLHostname() {
        const validDomain = (this.storageSettings.values.forwardingMode === 'Custom Domain' && this.storageSettings.values.hostname)
            || (this.storageSettings.values.duckDnsCertValid && this.storageSettings.values.duckDnsHostname && this.storageSettings.values.upnpPort && `${this.storageSettings.values.duckDnsHostname}:${this.storageSettings.values.upnpPort}`);
        return validDomain;
    }

    getHostname() {
        return this.getSSLHostname() || SCRYPTED_SERVER;
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
        const args = qsstringify({
            hostname: os.hostname(),
            registration_id: await this.manager.registrationId,
            sender_id: DEFAULT_SENDER_ID,
            redirect_uri: `https://${SCRYPTED_SERVER}/web/oauth/callback`,
        })
        return `https://${SCRYPTED_SERVER}/_punch/login?${args}`;
        // this is disabled because we can't assume that custom domains will implement this oauth endpoint.
        // return `https://${this.getHostname()}/_punch/login?${args}`
    }

    async onOauthCallback(callbackUrl: string) {
    }

    async setupProxyServer() {
        // TODO: 1/25/2023 change this to getInsecurePublicLocalEndpoint to avoid double crypto
        const secure = false;
        const ep = secure ? await endpointManager.getPublicLocalEndpoint() : await endpointManager.getInsecurePublicLocalEndpoint();
        const httpTarget = new URL(ep);
        httpTarget.hostname = '127.0.0.1';
        httpTarget.pathname = '';
        const wsTarget = new URL(httpTarget);
        wsTarget.protocol = secure ? 'wss' : 'ws';
        const googleHomeTarget = new URL(httpTarget);
        googleHomeTarget.pathname = '/endpoint/@scrypted/google-home/public/';
        const alexaTarget = new URL(httpTarget);
        alexaTarget.pathname = '/endpoint/@scrypted/alexa/public/';

        const headers = {
            'X-Forwarded-Proto': 'https',
        };

        const handler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
            this.console.log(req.socket?.remoteAddress, req.url);

            const url = new URL(req.url, 'https://localhost');
            if (url.pathname.startsWith('/web/oauth/callback') && url.search) {
                const query = qsparse(url.searchParams);
                if (!query.callback_url && query.token_info && query.user_info) {
                    this.storageSettings.values.token_info = query.token_info;
                    this.storageSettings.values.lastPersistedRegistrationId = await this.manager.registrationId;
                    res.setHeader('Location', `https://${this.getHostname()}/endpoint/@scrypted/core/public/`);
                    res.writeHead(302);
                    res.end();
                    return;
                }
                else {
                    this.oauthCallback(req, res);
                    return;
                }
            }
            else if (url.pathname === '/web/') {
                const validDomain = this.getSSLHostname();
                if (validDomain) {
                    res.setHeader('Location', `https://${validDomain}/endpoint/@scrypted/core/public/`);
                }
                else {
                    res.setHeader('Location', '/endpoint/@scrypted/core/public/');
                }
                res.writeHead(302);
                res.end();
                return;
            }
            else if (url.pathname === '/web/component/home/endpoint') {
                this.proxy.web(req, res, {
                    target: googleHomeTarget.toString(),
                    ignorePath: true,
                    secure: false,
                });
                return;
            }
            else if (url.pathname === '/web/component/alexa/endpoint') {
                this.proxy.web(req, res, {
                    target: alexaTarget.toString(),
                    ignorePath: true,
                    secure: false,
                });
                return;
            }

            this.proxy.web(req, res, { headers }, (err) => console.error(err));
        }

        const wsHandler = (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
            this.console.log(req.socket?.remoteAddress, req.url);
            this.proxy.ws(req, socket, head, { target: wsTarget.toString(), ws: true, secure: false, headers }, (err) => console.error(err))
        };

        this.server = http.createServer(handler);
        this.server.keepAliveTimeout = 0;
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

        const agent = new http.Agent({ maxSockets: Number.MAX_VALUE, keepAlive: true });
        this.proxy = HttpProxy.createProxy({
            agent,
            target: httpTarget,
            secure: false,
        });
        this.proxy.on('error', () => { });
        this.proxy.on('proxyRes', (res, req) => {
            res.headers['X-Scrypted-Cloud'] = req.headers['x-scrypted-cloud'];
            res.headers['X-Scrypted-Direct-Address'] = req.headers['x-scrypted-direct-address'];
            res.headers['X-Scrypted-Cloud-Address'] = this.cloudflareTunnel;
            res.headers['Access-Control-Expose-Headers'] = 'X-Scrypted-Cloud, X-Scrypted-Direct-Address, X-Scrypted-Cloud-Address';
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

                const registrationId = await this.manager.registrationId;
                this.ensureReverseConnections(registrationId);

                const client = tls.connect(4001, SCRYPTED_SERVER, {
                    rejectUnauthorized: false,
                });
                client.on('close', () => this.console.log('scrypted server connection ended:', random));
                client.write(registrationId + '\n');
                const mux: any = new bpmux.BPMux(client as any);
                mux.on('handshake', async (socket: Duplex) => {
                    this.ensureReverseConnections(registrationId);

                    this.console.warn('mux connection required');

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

        this.startCloudflared();
    }

    async startCloudflared() {
        while (true) {
            try {
                this.console.log('starting cloudflared');
                this.cloudflared = await backOff(async () => {
                    const pluginVolume = process.env.SCRYPTED_PLUGIN_VOLUME;
                    const cloudflareD = path.join(pluginVolume, 'cloudflare.d');
                    mkdirSync(cloudflareD, {
                        recursive: true,
                    })
                    process.chdir(cloudflareD);

                    if (!fs.existsSync(cloudflared.bin))
                        await cloudflared.install(cloudflared.bin);
                    const secureUrl = `https://127.0.0.1:${this.securePort}`;
                    const args: any = {};
                    if (this.storageSettings.values.cloudflaredTunnelToken) {
                        args['run'] = null;
                        args['--token'] = this.storageSettings.values.cloudflaredTunnelToken;
                    }
                    else {
                        args['--no-tls-verify'] = null;
                        args['--url'] = secureUrl;
                    }

                    const deferred = new Deferred<string>();
                    const cloudflareTunnel = cloudflared.tunnel(args);
                    cloudflareTunnel.child.stdout.on('data', data => this.console.log(data.toString()));
                    cloudflareTunnel.child.stderr.on('data', data => {
                        const string: string = data.toString();
                        this.console.error(string);

                        const lines = string.split('\n');
                        for (const line of lines) {
                            if (line.includes('hostname'))
                                this.console.log(line);
                            const config = line.split(' ').find(part => part.startsWith('config='));
                            if (config) {
                                const [, json] = config.split('config=');
                                this.console.log(json);
                                try {
                                    // the config is already json stringified and needs to be double parsed.
                                    // "{\"ingress\":[{\"hostname\":\"tunnel.example.com\",\"originRequest\":{\"noTLSVerify\":true},\"service\":\"https://localhost:52960\"},{\"service\":\"http_status:404\"}],\"warp-routing\":{\"enabled\":false}}"
                                    const parsed = JSON.parse(JSON.parse(json));
                                    const hostname = parsed.ingress?.[0]?.hostname;
                                    if (!hostname)
                                        deferred.resolve(undefined)
                                    else
                                        deferred.resolve(`https://${hostname}`)
                                }
                                catch (e) {
                                    this.console.error("Error parsing config", e);
                                }
                            }
                        }
                    });
                    cloudflareTunnel.child.on('exit', () => deferred.resolve(undefined));
                    try {
                        this.cloudflareTunnel = await Promise.any([deferred.promise, cloudflareTunnel.url]);
                        if (!this.cloudflareTunnel)
                            throw new Error('cloudflared exited, the provided cloudflare tunnel token may be invalid.')
                    }
                    catch (e) {
                        this.console.error('cloudflared error', e);
                        throw e;
                    }
                    this.console.log(`cloudflare url mapped ${this.cloudflareTunnel} to ${secureUrl}`);
                    return cloudflareTunnel;
                }, {
                    startingDelay: 60000,
                    timeMultiple: 1.2,
                    numOfAttempts: 1000,
                    maxDelay: 300000,
                });

                await once(this.cloudflared.child, 'exit');
                throw new Error('cloudflared exited.');
            }
            catch (e) {
                this.console.error('cloudflared error', e);
            }
            finally {
                this.cloudflared = undefined;
                this.cloudflareTunnel = undefined;
            }
        }
    }

    ensureReverseConnections(registrationId: string) {
        while (this.reverseConnections.size < 10) {
            this.createReverseConnection(registrationId);
        }
    }

    async createReverseConnection(registrationId: string) {
        const client = tls.connect(4001, SCRYPTED_SERVER, {
            rejectUnauthorized: false,
        });
        this.reverseConnections.add(client);
        const random = Math.random().toString(36).substring(2);
        let claimed = false;
        client.on('close', () => {
            this.console.log('scrypted server reverse connection ended:', random);
            this.reverseConnections.delete(client);

            if (claimed)
                this.ensureReverseConnections(registrationId);
        });
        client.write(`reverse:${registrationId}\n`);

        try {
            const read = await readLine(client);
        }
        catch (e) {
            return;
        }
        claimed = true;
        let local: any;

        await new Promise(resolve => process.nextTick(resolve));
        const port = (this.server.address() as any).port;

        local = net.connect({
            port,
            host: '127.0.0.1',
        });
        await new Promise(resolve => process.nextTick(resolve));

        client.pipe(local).pipe(client);
    }

    async oauthCallback(req: http.IncomingMessage, res: http.ServerResponse) {
        const reqUrl = new URL(req.url, 'https://localhost');

        try {
            const callback_url = reqUrl.searchParams.get('callback_url');
            if (!callback_url) {
                const html =
                    "<head>\n" +
                    "    <script>\n" +
                    "        window.location = '/web/oauth/callback?callback_url=' + encodeURIComponent(window.location.toString());\n" +
                    "    </script>\n" +
                    "</head>\n" +
                    "</head>\n" +
                    "</html>"
                res.end(html);
                return;
            }

            const url = new URL(callback_url as string);
            if (url.search) {
                const state = url.searchParams.get('state');
                if (state) {
                    const { s, d, r } = JSON.parse(state);
                    url.searchParams.set('state', s);
                    const oauthClient = systemManager.getDeviceById<OauthClient>(d);
                    await oauthClient.onOauthCallback(url.toString()).catch();
                    res.statusCode = 302;
                    res.setHeader('Location', r);
                    res.end();
                    return;
                }
            }
            if (url.hash) {
                const hash = new URLSearchParams(url.hash.substring(1));
                const state = hash.get('state');
                if (state) {
                    const { s, d, r } = JSON.parse(state);
                    hash.set('state', s);
                    url.hash = '#' + hash.toString();
                    const oauthClient = systemManager.getDeviceById<OauthClient>(d);
                    await oauthClient.onOauthCallback(url.toString());
                    res.statusCode = 302;
                    res.setHeader('Location', r);
                    res.end();
                    return;
                }
            }

            throw new Error('no state object found in query or hash');
        }
        catch (e) {
            res.statusCode = 500;
            res.end();
        }
    }

}

export default ScryptedCloud;
