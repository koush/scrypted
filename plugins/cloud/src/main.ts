import { Deferred } from "@scrypted/common/src/deferred";
import sdk, { HttpRequest, HttpRequestHandler, HttpResponse, MediaConverter, MediaObject, MediaObjectOptions, OauthClient, PushHandler, ScryptedDeviceBase, ScryptedInterface, ScryptedMimeTypes, Setting, Settings } from "@scrypted/sdk";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import bpmux from 'bpmux';
import { ChildProcess } from "child_process";
import * as cloudflared from 'cloudflared';
import crypto from 'crypto';
import { once } from 'events';
import { backOff } from "exponential-backoff";
import http from 'http';
import HttpProxy from 'http-proxy';
import https from 'https';
import upnp from 'nat-upnp';
import net from 'net';
import os from 'os';
import path from 'path';
import { Duplex } from 'stream';
import tls from 'tls';
import { readLine } from '../../../common/src/read-stream';
import { sleep } from '../../../common/src/sleep';
import { createSelfSignedCertificate } from '../../../server/src/cert';
import { httpFetch } from '../../../server/src/fetch/http-fetch';
import { installCloudflared } from "./cloudflared-install";
import { createLocallyManagedTunnel, runLocallyManagedTunnel } from "./cloudflared-local-managed";
import { PushManager } from './push';
import { qsparse, qsstringify } from "./qs";

const { deviceManager, endpointManager, systemManager } = sdk;

export const DEFAULT_SENDER_ID = '827888101440';
const SCRYPTED_SERVER = localStorage.getItem('scrypted-server') || 'home.scrypted.app';
const SCRYPTED_SERVER_PORT = 4001;

const SCRYPTED_CLOUD_MESSAGE_PATH = '/_punch/cloudmessage';

class ScryptedCloud extends ScryptedDeviceBase implements OauthClient, Settings, MediaConverter, HttpRequestHandler {
    cloudflareTunnel: string;
    cloudflared: {
        url: Promise<string>;
        child: ChildProcess;
    };
    manager = new PushManager(DEFAULT_SENDER_ID);
    server: http.Server;
    secureServer: https.Server;
    proxy: HttpProxy;
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
            persistedDefaultValue: crypto.randomBytes(8).toString('base64'),
        },
        cloudMessageToken: {
            hide: true,
            persistedDefaultValue: crypto.randomBytes(8).toString('hex'),
        },
        serverId: {
            hide: true,
            persistedDefaultValue: crypto.randomBytes(8).toString('hex'),
        },
        forwardingMode: {
            title: "Connection Mode",
            description: "The connection mode that exposes this server to the internet.",
            choices: [
                "Default",
                "UPNP",
                "Router Forward",
                "Custom Domain",
                "Disabled",
            ],
            defaultValue: 'Default',
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
            description: 'The internal https port used by the Scrypted Cloud plugin. Connections must be forwarded to this port on this server\'s internal IP address.',
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
        cloudflareEnabled: {
            group: 'Cloudflare',
            title: 'Cloudflare',
            type: 'boolean',
            description: 'Optional: Create a Cloudflare Tunnel to this server at a random domain name. Providing a Cloudflare token will allow usage of a custom domain name.',
            defaultValue: true,
        },
        cloudflaredTunnelToken: {
            group: 'Cloudflare',
            title: 'Cloudflare Tunnel Token',
            description: 'Optional: Enter the Cloudflare token from the Cloudflare Dashbaord to track and manage the tunnel remotely.',
            onPut: () => {
                this.cloudflared?.child.kill();
            },
            // this has been deprecated in favor of locally managed tunnels.
            hide: true,
        },
        cloudflaredTunnelCredentials: {
            group: 'Cloudflare',
            json: true,
            hide: true,
        },
        cloudflaredTunnelCustomDomain: {
            group: 'Cloudflare',
            title: 'Cloudflare Tunnel Custom Domain',
            placeholder: 'scrypted.example.com',
            description: 'Optional: Host a custom domain with Cloudflare. After setting the domain, complete the Cloudflare browser login link shown in Scrypted Cloud Plugin Console.',
            mapPut: (ov, nv) => {
                try {
                    const url = new URL(nv);
                    return url.hostname;
                }
                catch (e) {
                    return nv;
                }
            },
            onPut: (_, nv) => {
                if (!nv)
                    this.storageSettings.values.cloudflaredTunnelCredentials = undefined;
                this.doCloudflaredLogin(nv);
            },
            console: true,
        },
        cloudflaredTunnelLoginUrl: {
            group: 'Cloudflare',
            type: 'html',
            title: 'Cloudflare Tunnel Login',
            hide: true,
        },
        cloudflaredTunnelUrl: {
            group: 'Cloudflare',
            title: 'Cloudflare Tunnel URL',
            description: 'Cloudflare Tunnel URL is a randomized cloud connection, unless a Cloudflare Tunnel Token is provided.',
            readonly: true,
            mapGet: () => this.cloudflareTunnel || 'Unavailable',
        },
        serverName: {
            group: 'Connection',
            title: 'Server Name',
            description: 'The name of this server. This is used to identify this server in the Scrypted Cloud.',
            persistedDefaultValue: os.hostname()?.split('.')[0] || 'Scrypted Server',
        },
        connectHomeScryptedApp: {
            group: 'Connection',
            title: `Connect to ${SCRYPTED_SERVER}`,
            description: `Connect this server to ${SCRYPTED_SERVER}. This is required to use the Scrypted Cloud.`,
            type: 'boolean',
            persistedDefaultValue: true,
        },
        register: {
            group: 'Connection',
            title: 'Register',
            type: 'button',
            onPut: () => {
                this.manager.registrationId.then(r => this.sendRegistrationId(r))
            },
            description: 'Register server with Scrypted Cloud.',
        },
        testPortForward: {
            group: 'Connection',
            title: 'Test Port Forward',
            type: 'button',
            onPut: () => this.testPortForward(),
            description: 'Test the port forward connection from Scrypted Cloud.',
        },
        additionalCorsOrigins: {
            title: "Additional CORS Origins",
            description: "Debugging purposes only. DO NOT EDIT.",
            group: 'CORS',
            multiple: true,
            combobox: true,
            defaultValue: [],
        }
    });
    upnpInterval: NodeJS.Timeout;
    upnpClient = upnp.createClient();
    upnpStatus = 'Starting';
    randomBytes = crypto.randomBytes(16).toString('base64');
    reverseConnections = new Set<Duplex>();
    cloudflaredLoginController?: AbortController;

    get portForwardingDisabled() {
        return this.storageSettings.values.forwardingMode === 'Disabled' || this.storageSettings.values.forwardingMode === 'Default';
    }

    get cloudflareTunnelHost() {
        if (!this.cloudflareTunnel)
            return;
        return new URL(this.cloudflareTunnel).host;
    }

    constructor() {
        super();

        this.converters = [
            [ScryptedMimeTypes.LocalUrl, ScryptedMimeTypes.Url],
            [ScryptedMimeTypes.PushEndpoint, ScryptedMimeTypes.Url],
            ['*/*', ScryptedMimeTypes.ServerId],
        ];
        // legacy cleanup
        this.fromMimeType = undefined;
        this.toMimeType = undefined;
        deviceManager.onDevicesChanged({
            devices: [],
        });

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
            const hide = this.portForwardingDisabled;
            return {
                hide,
            }
        };

        this.storageSettings.settings.hostname.onGet = async () => {
            return {
                hide: this.storageSettings.values.forwardingMode !== 'Custom Domain',
            }
        };

        this.storageSettings.settings.cloudflaredTunnelCustomDomain.onGet =
            this.storageSettings.settings.cloudflaredTunnelUrl.onGet = async () => {
                return {
                    hide: !this.storageSettings.values.cloudflareEnabled,
                }
            };


        if (!this.storageSettings.values.certificate)
            this.storageSettings.values.certificate = createSelfSignedCertificate();

        if (this.storageSettings.values.cloudflaredTunnelCustomDomain && !this.storageSettings.values.cloudflaredTunnelCredentials)
            this.storageSettings.values.cloudflaredTunnelCustomDomain = undefined;

        this.log.clearAlerts();

        const proxy = this.setupProxyServer();
        this.updateCors();

        const observeRegistrations = () => {
            this.manager.on('registrationId', async (registrationId) => {
                // currently the fcm registration id never changes, so, there's no need.
                // if ever adding clockwork push, uncomment this.
                this.sendRegistrationId(registrationId);
            });

            this.upnpInterval = setInterval(() => this.refreshPortForward(), 30 * 60 * 1000);
            this.refreshPortForward();
        }

        // auto login from electron
        if (!this.storageSettings.values.token_info && process.env.SCRYPTED_CLOUD_TOKEN) {
            this.storageSettings.values.token_info = process.env.SCRYPTED_CLOUD_TOKEN;
            this.manager.registrationId.then(r => {
                this.sendRegistrationId(r, true);
                proxy.then(observeRegistrations);
            });
        }
        else {
            this.manager.registrationId.then(async registrationId => {
                if (this.storageSettings.values.lastPersistedRegistrationId !== registrationId)
                    this.sendRegistrationId(registrationId);
            });

            proxy.then(observeRegistrations);
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

    async getCachedRegistrationId() {
        return this.manager.currentRegistrationId || this.storageSettings.values.lastPersistedRegistrationId;
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
                await httpFetch({
                    url: url.toString(),
                });
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
            if (!this.cloudflareTunnelHost) {
                ip = (await httpFetch({
                    url: `https://${SCRYPTED_SERVER}/_punch/ip`,
                    responseType: 'json',
                })).body.ip;
            }

            if (this.cloudflareTunnelHost)
                ip = this.cloudflareTunnelHost
        }

        if (this.storageSettings.values.forwardingMode === 'Custom Domain' || this.cloudflareTunnelHost)
            upnpPort = 443;

        this.console.log(`Scrypted Cloud routing to https://${ip}:${upnpPort}`);

        // the ip is not sent, but should be checked to see if it changed.
        if (this.storageSettings.values.lastPersistedUpnpPort !== upnpPort || ip !== this.storageSettings.values.lastPersistedIp) {
            this.console.log('Registering IP and Port', ip, upnpPort);

            const data = await this.sendRegistrationId(await this.getCachedRegistrationId());
            if (data?.error)
                return;
            if (ip !== 'localhost' && ip !== data.ip_address && ip !== this.cloudflareTunnelHost) {
                this.log.a(`Scrypted Cloud could not verify the IP Address of your custom domain ${this.storageSettings.values.hostname}.`);
            }
            this.storageSettings.values.lastPersistedIp = ip;
        }
    }

    async testPortForward() {
        try {
            if (this.portForwardingDisabled)
                throw new Error('Port forwarding is disabled.');

            const pluginPath = await endpointManager.getPath(undefined, {
                public: true,
            });
            const url = new URL(`https://${SCRYPTED_SERVER}/_punch/curl`);
            let { port, hostname } = this.getAuthority();
            // scrypted cloud will replace localhost with requesting ip
            if (!hostname)
                hostname = 'localhost';
            url.searchParams.set('url', `https://${hostname}:${port}${pluginPath}/testPortForward`);
            const response = await httpFetch({
                url: url.toString(),
                responseType: 'json',
            });
            this.console.log('test data:', response.body);
            if (response.body.error)
                throw new Error(response.body.error);
            if (response.body.data !== this.randomBytes)
                throw new Error('Server received data that did not match this server.');
            this.log.a("Port Forward Test Succeeded.");
        }
        catch (e) {
            this.console.error('port forward test failed', e);
            this.log.a(`Port Forward Test Failed: ${e}`);
        }
    }

    async refreshPortForward() {
        let { upnpPort } = this.storageSettings.values;

        if (!upnpPort)
            upnpPort = Math.round(Math.random() * 20000 + 40000);

        if (this.portForwardingDisabled) {
            this.updatePortForward(upnpPort);
            return;
        }

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
            return this.updatePortForward(this.storageSettings.values.upnpPort);

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
                port: this.storageSettings.values.securePort,
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
            serverId: this.storageSettings.values.serverId,
            ttl,
        });
        const scope = await httpFetch({
            url: `https://${this.getHostname()}/_punch/scope?${q}`,
            headers: {
                Authorization: `Bearer ${token_info}`
            },
            responseType: 'json',
        })

        const { userToken, userTokenSignature } = scope.body;
        const tokens = qsstringify({
            user_token: userToken,
        });

        const url = `${baseUrl}${local.pathname}?${tokens}`;
        this.whitelisted.set(local.pathname, url);
        return Buffer.from(url);
    }

    async updateCors() {
        try {
            endpointManager.setAccessControlAllowOrigin({
                origins: [
                    'https://manage.scrypted.app',
                    `https://${SCRYPTED_SERVER}`,
                    ...this.storageSettings.values.additionalCorsOrigins,
                ],
            });
        }
        catch (e) {
            this.console.error('error updating cors, is your scrypted server up to date?', e);
        }
    }

    async updateExternalAddresses() {
        const addresses = await systemManager.getComponent('addresses');
        const cloudAddresses: string[] = [];
        if (this.storageSettings.values.hostname)
            cloudAddresses.push(`https://${this.storageSettings.values.hostname}`);
        if (this.cloudflareTunnel)
            cloudAddresses.push(this.cloudflareTunnel);

        await addresses.setExternalAddresses('@scrypted/cloud', cloudAddresses);

        await this.updatePortForward(this.storageSettings.values.upnpPort);
    }

    getAuthority() {
        if (this.portForwardingDisabled)
            return {};

        const { forwardingMode } = this.storageSettings.values;

        const upnp_port = forwardingMode === 'Custom Domain' ? 443 : this.storageSettings.values.upnpPort;
        const hostname = forwardingMode === 'Custom Domain'
            ? this.storageSettings.values.hostname
            : this.storageSettings.values.duckDnsToken && this.storageSettings.values.duckDnsHostname;

        if (upnp_port === 443 && !hostname) {
            const error = forwardingMode === 'Custom Domain'
                ? 'Hostname is required for port Custom Domain setup.'
                : 'Port 443 requires Custom Domain configuration.';
            this.log.a(error);
            throw new Error(error);
        }

        if (!hostname) {
            return {
                port: upnp_port,
            };
        }

        return {
            port: upnp_port,
            hostname,
        }
    }

    async sendRegistrationId(registration_id: string, force?: boolean) {
        const authority = this.getAuthority();

        const q = qsstringify({
            ...authority,
            cloudflare_hostname: this.cloudflareTunnelHost,
            registration_id,
            server_id: this.storageSettings.values.serverId,
            server_name: this.storageSettings.values.serverName,
            sender_id: DEFAULT_SENDER_ID,
            registration_secret: this.storageSettings.values.registrationSecret,
            force: force ? 'true' : '',
        });

        if (!this.storageSettings.values.connectHomeScryptedApp) {
            return {
                error: `Scrypted Cloud connection to ${SCRYPTED_SERVER} is disabled.`,
            };
        }

        const { token_info } = this.storageSettings.values;
        if (!token_info) {
            const error = `Login to the Scrypted Cloud plugin to reach this server from the cloud, or disable this alert in the Scrypted Cloud plugin Connection settings.`;
            this.log.a(error);
            return {
                error,
            };
        }
        try {
            const response = await httpFetch({
                url: `https://${SCRYPTED_SERVER}/_punch/register?${q}`,
                headers: {
                    Authorization: `Bearer ${token_info}`
                },
                responseType: 'json',
            })
            const error = response.body?.error;
            if (error) {
                this.console.log('registration error', response.body);
                this.log.a(error);
                return response.body;
            }

            this.console.log('registered', response.body);
            this.storageSettings.values.lastPersistedRegistrationId = registration_id;
            this.storageSettings.values.lastPersistedUpnpPort = authority.port;
            return response.body;
        }
        catch (e) {
            return {
                error: e.toString(),
            };
        }
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

    async releaseDevice(id: string, nativeId: string): Promise<void> {
    }

    getSSLHostname() {
        const validDomain = (this.storageSettings.values.forwardingMode === 'Custom Domain' && this.storageSettings.values.hostname)
            || (this.storageSettings.values.cloudflaredTunnelToken && this.cloudflareTunnelHost)
            || (this.storageSettings.values.cloudflaredTunnelCredentials && this.cloudflareTunnelHost)
            || (this.storageSettings.values.duckDnsCertValid && this.storageSettings.values.duckDnsHostname && this.storageSettings.values.upnpPort && `${this.storageSettings.values.duckDnsHostname}:${this.storageSettings.values.upnpPort}`);
        return validDomain;
    }

    getHostname() {
        return this.getSSLHostname() || SCRYPTED_SERVER;
    }

    async convertMedia(data: string | Buffer | any, fromMimeType: string, toMimeType: string, options?: MediaObjectOptions): Promise<MediaObject | Buffer | any> {
        if (toMimeType.startsWith(ScryptedMimeTypes.Url) && fromMimeType.startsWith(ScryptedMimeTypes.LocalUrl)) {
            // if cloudflare is enabled and the plugin isn't set up as a custom domain, try to use the cloudflare url for
            // short lived urls.
            if (this.cloudflareTunnel && this.storageSettings.values.forwardingMode !== 'Custom Domain') {
                const params = new URLSearchParams(toMimeType.split(';')[1] || '');
                if (params.get('short-lived') === 'true') {
                    const u = new URL(data.toString(), this.cloudflareTunnel);
                    u.host = this.cloudflareTunnelHost;
                    u.port = '';
                    return Buffer.from(u.toString());
                }
            }
            return this.whitelist(data.toString(), 10 * 365 * 24 * 60 * 60 * 1000, `https://${this.getHostname()}`);
        }
        else if (toMimeType.startsWith(ScryptedMimeTypes.Url) && fromMimeType.startsWith(ScryptedMimeTypes.PushEndpoint)) {
            const validDomain = this.getSSLHostname();
            if (validDomain)
                return Buffer.from(`https://${validDomain}${await this.getCloudMessagePath()}/${data}`);

            const url = `http://127.0.0.1/push/${data}`;
            return this.whitelist(url, 10 * 365 * 24 * 60 * 60 * 1000, `https://${this.getHostname()}${SCRYPTED_CLOUD_MESSAGE_PATH}`);
        }
        else if (toMimeType === ScryptedMimeTypes.ServerId) {
            return this.storageSettings.values.serverId;
        }

        throw new Error('unsupported cloud url conversion');
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
        const authority = this.getAuthority();

        const args = qsstringify({
            ...authority,

            registration_id: await this.getCachedRegistrationId() || 'undefined',
            cloudflare_hostname: this.cloudflareTunnelHost,
            registration_secret: this.storageSettings.values.registrationSecret,
            server_id: this.storageSettings.values.serverId,
            server_name: this.storageSettings.values.serverName,
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
                    this.storageSettings.values.lastPersistedRegistrationId = await this.getCachedRegistrationId();
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
            else if (url.pathname === '/_punch/callback') {
                const query = qsparse(url.searchParams);
                if (query.registration_secret === this.storageSettings.values.registrationSecret) {
                    res.writeHead(200);
                    this.serverCallback(port, SCRYPTED_SERVER_PORT, SCRYPTED_SERVER);
                }
                else {
                    res.writeHead(401);
                }
                res.end();
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
        this.console.log('scrypted cloud server listening on', port);

        this.storageSettings.settings.cloudflareEnabled.onPut = () => {
            this.cloudflared?.child.kill();
            this.startCloudflared(port);
        };

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
            res.headers['X-Scrypted-Server-Id'] = this.storageSettings.values.serverId;
            let domain = this.cloudflareTunnel;
            if (!domain && this.storageSettings.values.forwardingMode === 'Custom Domain' && this.storageSettings.values.hostname)
                domain = `https://${this.storageSettings.values.hostname}`;
            res.headers['X-Scrypted-Cloud-Address'] = domain;
            res.headers['Access-Control-Expose-Headers'] = 'X-Scrypted-Cloud, X-Scrypted-Direct-Address, X-Scrypted-Cloud-Address, X-Scrypted-Server-Id';
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
                const { address } = message;
                const [serverHost, serverPort] = address?.split(':') || [SCRYPTED_SERVER, SCRYPTED_SERVER_PORT];
                this.serverCallback(port, Number(serverPort), serverHost);
            }
        });

        this.startCloudflared(port);

        while (true) {
            try {
                this.secureServer = https.createServer({
                    key: this.storageSettings.values.certificate.serviceKey,
                    cert: this.storageSettings.values.certificate.certificate,
                }, handler);
                this.secureServer.on('upgrade', wsHandler)
                // this is the direct connection port
                this.secureServer.listen(this.storageSettings.values.securePort, '0.0.0.0');
                await once(this.secureServer, 'listening');
                this.storageSettings.values.securePort = (this.secureServer.address() as any).port;
                break;

            }
            catch (e) {
                this.console.log('error starting secure server. retrying.', e);
                await sleep(60000);
            }
        }
    }

    serverCallback(port: number, serverPort: number, serverHost: string) {
        const random = Math.random().toString(36).substring(2);
        this.console.log('scrypted server requested a connection:', random);

        this.ensureReverseConnections(serverPort, serverHost);

        const client = tls.connect(serverPort, serverHost, {
            rejectUnauthorized: false,
        });
        client.on('close', () => this.console.log('scrypted server connection ended:', random));
        client.write(this.serverIdentifier + '\n');
        const mux: any = new bpmux.BPMux(client as any);
        mux.on('handshake', async (socket: Duplex) => {
            this.ensureReverseConnections(serverPort, serverHost);

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
        mux.on('error', () => {
            client.destroy();
        });
    }

    async startCloudflared(quickTunnelPort: number) {
        while (true) {
            try {
                if (!this.storageSettings.values.cloudflareEnabled) {
                    this.console.log('cloudflared is disabled.');
                    return;
                }

                this.console.log('starting cloudflared');
                this.cloudflared = await backOff(async () => {
                    const { cloudflareD, bin } = await installCloudflared();

                    if (this.storageSettings.values.cloudflaredTunnelCredentials && this.storageSettings.values.cloudflaredTunnelCustomDomain) {
                        const tunnelUrl = `http://127.0.0.1:${quickTunnelPort}`;
                        const url = this.cloudflareTunnel = `https://${this.storageSettings.values.cloudflaredTunnelCustomDomain}`;
                        this.updateExternalAddresses();
                        this.console.log(`cloudflare url mapped ${this.cloudflareTunnel} to ${tunnelUrl}`);

                        const ret = await runLocallyManagedTunnel(this.storageSettings.values.cloudflaredTunnelCredentials, tunnelUrl, cloudflareD, bin);
                        return {
                            child: ret,
                            url: Promise.resolve(url),
                        }
                    }

                    // npm cloudflared package kinda sucks.
                    process.chdir(cloudflareD);

                    let tunnelUrl: string

                    const args: any = {};
                    if (this.storageSettings.values.cloudflaredTunnelToken) {
                        this.log.a('Cloudflare tunnel tokens are no longer supported. Please use the new Cloudflare Tunnel Custom Domain option.');
                        tunnelUrl = `https://127.0.0.1:${this.storageSettings.values.securePort}`;
                        args['run'] = null;
                        args['--token'] = this.storageSettings.values.cloudflaredTunnelToken;
                    }
                    else {
                        tunnelUrl = `http://127.0.0.1:${quickTunnelPort}`;
                        args['--url'] = tunnelUrl;
                    }

                    // if error messages are detected after 10 minutes from tunnel attempt start,
                    // kill the tunnel.
                    const tenMinutesMs = 10 * 60 * 1000;
                    const tunnelStart = Date.now();
                    const deferred = new Deferred<string>();

                    const cloudflareTunnel = cloudflared.tunnel(args);
                    deferred.resolvePromise(cloudflareTunnel.url);

                    const processData = (string: string) => {
                        const lines = string.split('\n');
                        for (const line of lines) {
                            if ((line.includes('Unregistered tunnel connection')
                                || line.includes('Connection terminated error')
                                || line.includes('Register tunnel error')
                                || line.includes('Failed to serve tunnel')
                                || line.includes('Failed to get tunnel'))
                                && (deferred.finished || Date.now() - tunnelStart > tenMinutesMs)) {
                                this.console.warn('Cloudflare registration failure detected. Terminating.');
                                cloudflareTunnel.child.kill();
                            }
                            const match = /config=(".*?}")/gm.exec(line)
                            if (match) {
                                const json = match[1];
                                this.console.log(json);
                                try {
                                    // the config is already json stringified and needs to be double parsed.
                                    // '2023-09-02T21:18:10Z INF Updated to new configuration config="{\"ingress\":[{\"hostname\":\"tunneltest.example.com\", \"originRequest\":{\"noTLSVerify\":true}, \"service\":\"https://localhost:52960\"}, {\"service\":\"http_status:404\"}], \"warp-routing\":{\"enabled\":false}}" version=6'
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
                    };

                    cloudflareTunnel.child.stdout.on('data', data => {
                        const d = data.toString();
                        this.console.log(d);
                        processData(d);
                    });
                    cloudflareTunnel.child.stderr.on('data', data => {
                        const d = data.toString();
                        this.console.error(d);
                        processData(d);
                    });

                    cloudflareTunnel.child.on('exit', () => deferred.resolve(undefined));
                    try {
                        this.cloudflareTunnel = await Promise.any([deferred.promise, cloudflareTunnel.url]);
                        this.updateExternalAddresses();
                        if (!this.cloudflareTunnel)
                            throw new Error('cloudflared exited, the provided cloudflare tunnel token may be invalid.')
                    }
                    catch (e) {
                        this.console.error('cloudflared error', e);
                        throw e;
                    }
                    this.console.log(`cloudflare url mapped ${this.cloudflareTunnel} to ${tunnelUrl}`);
                    return {
                        url: deferred.promise,
                        child: cloudflareTunnel.child,
                    };
                }, {
                    startingDelay: 60000,
                    timeMultiple: 1.2,
                    numOfAttempts: 1000,
                    maxDelay: 300000,
                });

                await once(this.cloudflared.child, 'exit').catch(() => { });
                // the successfully started cloudflared process may exit at some point, loop and allow it to restart.
                this.console.error('cloudflared exited');
            }
            catch (e) {
                // this error may be reached if the cloudflared backoff fails.
                this.console.error('cloudflared error', e);
            }
            finally {
                this.cloudflared = undefined;
                this.cloudflareTunnel = undefined;
                this.updateExternalAddresses();
            }
        }
    }

    get serverIdentifier() {
        const serverIdentifier = `${this.storageSettings.values.registrationSecret}@${this.storageSettings.values.serverId}`;
        return serverIdentifier;
    }

    ensureReverseConnections(serverPort: number, serverHost: string) {
        while (this.reverseConnections.size < 10) {
            this.createReverseConnection(serverPort, serverHost);
        }
    }

    async createReverseConnection(serverPort: number, serverHost: string) {
        const client = tls.connect(serverPort, serverHost, {
            rejectUnauthorized: false,
        });
        this.reverseConnections.add(client);
        const random = Math.random().toString(36).substring(2);
        let claimed = false;
        client.on('close', () => {
            this.console.log('scrypted server reverse connection ended:', random);
            this.reverseConnections.delete(client);

            if (claimed)
                this.ensureReverseConnections(serverPort, serverHost);
        });

        client.write(`reverse:${this.serverIdentifier}\n`);

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

    async doCloudflaredLogin(domain: string) {
        if (!domain) {
            this.cloudflared?.child.kill();
            return;
        }

        // this.log.a('Visit the URL printed in the Scrypted Cloud plugin console to log into Cloudflare.');
        const customDomain = this.storageSettings.values.cloudflaredTunnelCustomDomain;
        try {
            this.cloudflaredLoginController?.abort();
            this.cloudflaredLoginController = new AbortController();
            const { bin } = await installCloudflared();
            const jsonContents = await createLocallyManagedTunnel(domain, bin, this.cloudflaredLoginController.signal, url => {
                this.console.warn('Cloudflare login URL:', url);
                this.storageSettings.values.cloudflaredTunnelLoginUrl = `<div style="padding-bottom: 16px"><a href="${url}" target="_blank" >Click here to log into Cloudflare</a></div>`;
                this.storageSettings.settings.cloudflaredTunnelLoginUrl.hide = false;
                this.onDeviceEvent(ScryptedInterface.Settings, undefined);
            });
            this.storageSettings.values.cloudflaredTunnelCredentials = jsonContents;
            this.storageSettings.values.cloudflaredTunnelToken = undefined;
            this.cloudflared?.child.kill();
        }
        catch (e) {
            if (customDomain)
                this.storageSettings.values.cloudflaredTunnelCustomDomain = undefined;
            this.console.error('cloudflared login error', e);
            this.log.a('Cloudflare login error. See console logs.');
        }
    }
}

export default ScryptedCloud;
