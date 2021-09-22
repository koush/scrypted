import { Level } from './level';
import { PluginHost } from './plugin/plugin-host';
import cluster from 'cluster';
import { Device, EngineIOHandler, HttpRequest, HttpRequestHandler, OauthClient, PushHandler, ScryptedDevice, ScryptedInterface, ScryptedInterfaceProperty } from '@scrypted/sdk/types';
import { PluginDeviceProxyHandler } from './plugin/plugin-device';
import { Plugin, PluginDevice, ScryptedAlert } from './db-types';
import { getState, ScryptedStateManager, setState } from './state';
import { Request, Response, Router } from 'express';
import { createResponseInterface } from './http-interfaces';
import bodyParser from 'body-parser';
import http, { ServerResponse } from 'http';
import https from 'https';
import express from 'express';
import { LogEntry, Logger, makeAlertId } from './logger';
import { getDisplayName, getDisplayRoom, getDisplayType, getProvidedNameOrDefault, getProvidedRoomOrDefault, getProvidedTypeOrDefault } from './infer-defaults';
import { URL } from "url";
import qs from "query-string";
import { PluginComponent } from './component/plugin';
import { Server as WebSocketServer } from "ws";
import axios from 'axios';
import tar from 'tar';
import { once } from 'events';
import { PassThrough } from 'stream';

interface DeviceProxyPair {
    handler: PluginDeviceProxyHandler;
    proxy: ScryptedDevice;
}

interface PluginDebug {
    waitDebug: Promise<void>;
    inspectPort: number;
}

export class ScryptedRuntime {
    datastore: Level;
    plugins: { [id: string]: PluginHost } = {};
    pluginDevices: { [id: string]: PluginDevice } = {};
    devices: { [id: string]: DeviceProxyPair } = {};
    stateManager = new ScryptedStateManager(this);
    app: Router;
    logger = new Logger(this, '', 'Scrypted');
    devicesLogger = this.logger.getLogger('device', 'Devices');
    wss = new WebSocketServer({ noServer: true });
    wsAtomic = 0;

    constructor(datastore: Level, insecure: http.Server, secure: https.Server, app: express.Application) {
        this.datastore = datastore;
        this.app = app;

        app.disable('x-powered-by');

        app.all(['/endpoint/@:owner/:pkg/public/engine.io/*', '/endpoint/:pkg/public/engine.io/*'], (req, res) => {
            this.endpointHandler(req, res, true, true, this.handleEngineIOEndpoint.bind(this))
        });

        app.all(['/endpoint/@:owner/:pkg/engine.io/*', '/endpoint/@:owner/:pkg/engine.io/*'], (req, res) => {
            this.endpointHandler(req, res, false, true, this.handleEngineIOEndpoint.bind(this))
        });

        // stringify all http endpoints
        app.all(['/endpoint/@:owner/:pkg/public', '/endpoint/@:owner/:pkg/public/*', '/endpoint/:pkg', '/endpoint/:pkg/*'], bodyParser.text() as any);

        app.all(['/endpoint/@:owner/:pkg/public', '/endpoint/@:owner/:pkg/public/*', '/endpoint/:pkg/public', '/endpoint/:pkg/public/*'], (req, res) => {
            this.endpointHandler(req, res, true, false, this.handleRequestEndpoint.bind(this))
        });

        app.all(['/endpoint/@:owner/:pkg', '/endpoint/@:owner/:pkg/*', '/endpoint/:pkg', '/endpoint/:pkg/*'], (req, res) => {
            this.endpointHandler(req, res, false, false, this.handleRequestEndpoint.bind(this))
        });

        app.get('/web/oauth/callback', (req, res) => {
            this.oauthCallback(req, res);
        });

        insecure.on('upgrade', (req, socket, upgradeHead) => {
            (req as any).upgradeHead = upgradeHead;
            (app as any).handle(req, {
                socket,
                upgradeHead
            })
        })

        secure.on('upgrade', (req, socket, upgradeHead) => {
            (req as any).upgradeHead = upgradeHead;
            (app as any).handle(req, {
                socket,
                upgradeHead
            })
        })

        this.logger.on('log', (logEntry: LogEntry) => {
            if (logEntry.level !== 'a')
                return;

            console.log('alert', logEntry);
            const alert = new ScryptedAlert();
            alert._id = makeAlertId(logEntry.path, logEntry.message);
            alert.message = logEntry.message;
            alert.timestamp = logEntry.timestamp;
            alert.path = logEntry.path;
            alert.title = logEntry.title;

            datastore.upsert(alert);

            this.stateManager.notifyInterfaceEvent(null, 'Logger' as any, logEntry);
        });

        // purge logs older than 2 hours every hour
        setInterval(() => {
            this.logger.purge(Date.now() - 2 * 60 * 60 * 1000);
        }, 60 * 60 * 1000);
    }

    getDeviceLogger(device: PluginDevice): Logger {
        return this.devicesLogger.getLogger(device._id, getState(device, ScryptedInterfaceProperty.name));
    }

    async oauthCallback(req: Request, res: Response) {
        try {
            const { callback_url } = req.query;
            if (!callback_url) {
                const html =
                    "<head>\n" +
                    "    <script>\n" +
                    "        window.location = '/web/oauth/callback?callback_url=' + encodeURIComponent(window.location.toString());\n" +
                    "    </script>\n" +
                    "</head>\n" +
                    "</head>\n" +
                    "</html>"
                res.send(html);
                return;
            }

            const url = new URL(callback_url as string);
            if (url.search) {
                const search = qs.parse(url.search);
                const state = search.state as string;
                if (state) {
                    const { s, d, r } = JSON.parse(state);
                    search.state = s;
                    url.search = '?' + qs.stringify(search);
                    const oauthClient: ScryptedDevice & OauthClient = this.getDevice(d);
                    await oauthClient.onOauthCallback(url.toString()).catch();
                    res.redirect(r);
                    return;
                }
            }
            if (url.hash) {
                const hash = qs.parse(url.hash);
                const state = hash.state as string;
                if (state) {
                    const { s, d, r } = JSON.parse(state);
                    hash.state = s;
                    url.hash = '#' + qs.stringify(hash);
                    const oauthClient: ScryptedDevice & OauthClient = this.getDevice(d);
                    await oauthClient.onOauthCallback(url.toString());
                    res.redirect(r);
                    return;
                }
            }

            throw new Error('no state object found in query or hash');
        }
        catch (e) {
            res.status(500);
            res.send();
        }
    }

    async getPluginForEndpoint(endpoint: string) {
        let pluginHost = this.plugins[endpoint] ?? this.getPluginHostForDeviceId(endpoint);
        if (!pluginHost && endpoint === '@scrypted/core') {
            try {
                pluginHost = await this.installNpm('@scrypted/core');
            }
            catch (e) {
                console.error('@scrypted/core auto install failed', e);
            }
        }

        const pluginDevice = this.findPluginDevice(endpoint) ?? this.findPluginDeviceById(endpoint);

        return {
            pluginHost,
            pluginDevice,
        };
    }

    async deliverPush(endpoint: string, request: HttpRequest) {
        const { pluginHost, pluginDevice } = await this.getPluginForEndpoint(endpoint);
        if (!pluginDevice) {
            console.error('plugin device missing for', endpoint);
            return;
        }

        if (!pluginDevice?.state.interfaces.value.includes(ScryptedInterface.PushHandler)) {
            return;
        }

        const handler = this.getDevice<PushHandler>(pluginDevice._id);
        return handler.onPush(request);
    }

    async endpointHandler(req: Request, res: Response, isPublicEndpoint: boolean, isEngineIOEndpoint: boolean,
        handler: (req: Request, res: Response, endpointRequest: HttpRequest, pluginHost: PluginHost, pluginDevice: PluginDevice) => void) {

        const isUpgrade = req.headers.connection?.toLowerCase() === 'upgrade';

        const end = (code: number, message: string) => {
            if (isUpgrade) {
                const socket = res.socket;
                socket.write(`HTTP/1.1 ${code} ${message}\r\n` +
                    '\r\n');
                socket.destroy();
            }
            else {
                res.status(code);
                res.send(message);
            }
        };

        if (!isPublicEndpoint && !res.locals.username) {
            end(401, 'Not Authorized');
            return;
        }

        const { owner, pkg } = req.params;
        let endpoint = pkg;
        if (owner)
            endpoint = `@${owner}/${endpoint}`;

        const { pluginHost, pluginDevice } = await this.getPluginForEndpoint(endpoint);

        // check if upgrade requests can be handled. must be websocket.
        if (isUpgrade) {
            if (req.headers.upgrade?.toLowerCase() !== 'websocket' || !pluginDevice?.state.interfaces.value.includes(ScryptedInterface.EngineIOHandler)) {
                end(404, 'Not Found');
                return;
            }
        }
        else {
            if (!isEngineIOEndpoint && !pluginDevice?.state.interfaces.value.includes(ScryptedInterface.HttpRequestHandler)) {
                end(404, 'Not Found');
                return;
            }
        }

        let rootPath = `/endpoint/${endpoint}`;
        if (isPublicEndpoint)
            rootPath += '/public'

        const body = req.body && typeof req.body !== 'string' ? JSON.stringify(req.body) : req.body;

        const httpRequest: HttpRequest = {
            body,
            headers: req.headers,
            method: req.method,
            rootPath,
            url: req.url,
            isPublicEndpoint,
            username: res.locals.username,
        };

        if (isEngineIOEndpoint && !isUpgrade && isPublicEndpoint) {
            res.header("Access-Control-Allow-Origin", '*');
        }

        if (!isEngineIOEndpoint && isUpgrade) {
            this.wss.handleUpgrade(req, req.socket, (req as any).upgradeHead, ws => {
                try {
                    const handler = this.getDevice<EngineIOHandler>(pluginDevice._id);
                    const id = 'ws-' + this.wsAtomic++;
                    const pluginHost = this.plugins[endpoint] ?? this.getPluginHostForDeviceId(endpoint);
                    if (!pluginHost) {
                        ws.close();
                        return;
                    }
                    pluginHost.ws[id] = ws;

                    handler.onConnection(httpRequest, `ws://${id}`);

                    ws.on('message', async (message) => {
                        try {
                            pluginHost.remote.ioEvent(id, 'message', message)
                        }
                        catch (e) {
                            ws.close();
                        }
                    });
                    ws.on('close', async (reason) => {
                        try {
                            pluginHost.remote.ioEvent(id, 'close');
                        }
                        catch (e) {
                        }
                        delete pluginHost.ws[id];
                    });
                }
                catch (e) {
                    console.error('websocket plugin error', e);
                    ws.close();
                }
            });
        }
        else {
            handler(req, res, httpRequest, pluginHost, pluginDevice);
        }
    }

    async getComponent(componentId: string): Promise<any> {
        const self = this;
        switch (componentId) {
            case 'plugins':
                return new PluginComponent(this);
            case 'logger':
                return this.logger;
            case 'alerts':
                class Alerts {
                    async getAlerts(): Promise<ScryptedAlert[]> {
                        const ret = [];
                        for await (const alert of self.datastore.getAll(ScryptedAlert)) {
                            ret.push(alert);
                        }
                        return ret;
                    }
                    async removeAlert(alert: ScryptedAlert) {
                        await self.datastore.removeId(ScryptedAlert, alert._id);
                        self.stateManager.notifyInterfaceEvent(null, 'Logger' as any, undefined);
                    }
                    async clearAlerts() {
                        await self.datastore.removeAll(ScryptedAlert);
                        self.stateManager.notifyInterfaceEvent(null, 'Logger' as any, undefined);
                    }
                }
                return new Alerts();
        }
    }

    async handleEngineIOEndpoint(req: Request, res: ServerResponse, endpointRequest: HttpRequest, pluginHost: PluginHost, pluginDevice: PluginDevice) {
        (req as any).scrypted = {
            endpointRequest,
            pluginDevice,
        };
        if ((req as any).upgradeHead)
            pluginHost.io.handleUpgrade(req, res.socket, (req as any).upgradeHead)
        else
            pluginHost.io.handleRequest(req, res);
    }

    async handleRequestEndpoint(req: Request, res: Response, endpointRequest: HttpRequest, pluginHost: PluginHost, pluginDevice: PluginDevice) {
        try {
            const handler = this.getDevice<HttpRequestHandler>(pluginDevice._id);
            if (handler.interfaces.includes(ScryptedInterface.EngineIOHandler) && req.headers.connection === 'upgrade' && req.headers.upgrade?.toLowerCase() === 'websocket') {
                this.wss.handleUpgrade(req, req.socket, null, ws => {
                    console.log(ws);
                });
            }
            handler.onRequest(endpointRequest, createResponseInterface(res, pluginHost));
        }
        catch (e) {
            res.status(500);
            res.send(e.toString());
            console.error(e);
        }
    }

    async killPlugin(plugin: Plugin) {
        const existing = this.plugins[plugin._id];
        if (existing) {
            delete this.plugins[plugin._id];
            existing.kill();
        }
    }

    invalidatePluginDevice(id: string) {
        const proxyPair = this.devices[id];
        if (!proxyPair)
            return;
        proxyPair.handler.invalidate();
        return proxyPair;
    }

    async installNpm(pkg: string, version?: string): Promise<PluginHost> {
        const registry = (await axios(`https://registry.npmjs.org/${pkg}`)).data;
        if (!version) {
            version = registry['dist-tags'].latest;
        }
        console.log('installing package', pkg, version);

        const tarball = (await axios(`${registry.versions[version].dist.tarball}`, {
            responseType: 'arraybuffer'
        })).data;
        console.log('downloaded tarball', tarball?.length);
        const parse = new (tar.Parse as any)();
        const files: { [name: string]: Buffer } = {};

        parse.on('entry', async (entry: tar.ReadEntry) => {
            console.log('parsing entry', entry.path)
            const chunks: Buffer[] = [];
            entry.on('data', data => chunks.push(data));

            entry.on('end', () => {
                const buffer = Buffer.concat(chunks);
                files[entry.path] = buffer;
            })
        });

        const ret = (async () => {
            await once(parse, 'end');
            console.log('npm package files:', Object.keys(files).join(', '));
            const packageJsonEntry = files['package/package.json'];
            if (!packageJsonEntry)
                throw new Error('package.json not found. are you behind a firewall?');
            const packageJson = JSON.parse(packageJsonEntry.toString());
            const npmPackage = packageJson.name;
            const plugin = await this.datastore.tryGet(Plugin, npmPackage) || new Plugin();

            plugin._id = npmPackage;
            plugin.packageJson = packageJson;
            plugin.zip = files['package/dist/plugin.zip'].toString('base64');
            await this.datastore.upsert(plugin);

            return this.installPlugin(plugin);
        })();

        const pt = new PassThrough();
        pt.write(Buffer.from(tarball));
        pt.push(null);
        pt.pipe(parse);
        return ret;
    }

    async installPlugin(plugin: Plugin, pluginDebug?: PluginDebug): Promise<PluginHost> {
        await this.upsertDevice(plugin._id, plugin.packageJson.scrypted);
        return this.runPlugin(plugin, pluginDebug);
    }

    async runPlugin(plugin: Plugin, pluginDebug?: PluginDebug) {
        await this.killPlugin(plugin);

        const pluginDevices = this.findPluginDevices(plugin._id);
        for (const pluginDevice of pluginDevices) {
            this.invalidatePluginDevice(pluginDevice._id);
        }

        if (pluginDebug) {
            console.log('plugin inspect port', pluginDebug.inspectPort)
            cluster.setupMaster({
                silent: true,
                inspectPort: pluginDebug.inspectPort,
                execArgv: process.argv[0].endsWith('ts-node') ? ['--inspect', '-r', 'ts-node/register'] : ['--inspect'],
            });
        }
        else {
            cluster.setupMaster({
                silent: true,
                execArgv: process.argv[0].endsWith('ts-node') ? ['-r', 'ts-node/register'] : [],
            });
        }

        const pluginHost = new PluginHost(this, plugin, pluginDebug?.waitDebug);
        this.plugins[plugin._id] = pluginHost;

        return pluginHost;
    }

    findPluginDevice?(pluginId: string, nativeId?: string): PluginDevice {
        // JSON stringify over rpc turns undefined into null.
        if (nativeId === null)
            nativeId = undefined;
        return Object.values(this.pluginDevices).find(device => device.pluginId === pluginId && device.nativeId == nativeId);
    }

    findPluginDeviceById(id: string): PluginDevice {
        return this.pluginDevices[id];
    }

    findPluginDevices(pluginId: string): PluginDevice[] {
        return Object.values(this.pluginDevices).filter(e => e.pluginId === pluginId)
    }

    getPluginHostForDeviceId(id: string): PluginHost {
        const device = this.pluginDevices[id];
        if (!device)
            return;
        return this.plugins[device.pluginId];
    }

    getDevice<T>(id: string): T & ScryptedDevice {
        const device = this.devices[id];
        if (device)
            return device.proxy as any;

        if (!this.pluginDevices[id]) {
            console.warn('device not found', id);
            return;
        }

        const handler = new PluginDeviceProxyHandler(this, id);
        const proxy = new Proxy(handler, handler);

        this.devices[id] = {
            proxy,
            handler,
        };
        return proxy;
    }

    async removeDevice(device: PluginDevice) {
        const providerId = getState(device, ScryptedInterfaceProperty.providerId);
        const providedDevices = Object.values(this.pluginDevices).filter(pluginDevice => getState(pluginDevice, ScryptedInterfaceProperty.providerId) === device._id);
        for (const provided of providedDevices) {
            if (provided === device)
                continue;
            await this.removeDevice(provided);
        }
        device.state = undefined;

        delete this.pluginDevices[device._id];
        await this.datastore.remove(device);
        if (providerId == null || providerId === device._id) {
            const plugin = await this.datastore.tryGet(Plugin, device.pluginId);
            await this.killPlugin(plugin);
            await this.datastore.remove(plugin);
        }
        this.stateManager.removeDevice(device._id);

        // remove the plugin too
        if (!device.nativeId) {
            const plugin = this.plugins[device.pluginId];
            plugin?.kill();
            await this.datastore.removeId(Plugin, device.pluginId);
        }
    }

    upsertDevice(pluginId: string, device: Device, invalidate?: boolean): Promise<PluginDevice> {
        // JSON stringify over rpc turns undefined into null.
        if (device.nativeId === null)
            device.nativeId = undefined;
        let newDevice = false;
        let pluginDevice = this.findPluginDevice(pluginId, device.nativeId);
        if (!pluginDevice) {
            pluginDevice = new PluginDevice(this.datastore.nextId().toString());
            newDevice = true;
        }
        this.pluginDevices[pluginDevice._id] = pluginDevice;
        pluginDevice.pluginId = pluginId;
        pluginDevice.nativeId = device.nativeId;
        pluginDevice.state = pluginDevice.state || {};
        const provider = this.findPluginDevice(pluginId, device.providerNativeId);

        const providedType = device.type;
        const isUsingDefaultType = getDisplayType(pluginDevice) === getProvidedTypeOrDefault(pluginDevice);
        const providedName = device.name;
        const isUsingDefaultName = getDisplayName(pluginDevice) === getProvidedNameOrDefault(pluginDevice);
        const providedRoom = device.room;
        const isUsingDefaultRoom = getDisplayRoom(pluginDevice) === getProvidedRoomOrDefault(pluginDevice);

        const providedInterfaces = [...new Set(device.interfaces || [])].sort();
        // assure final mixin resolved interface list has at least all the
        // interfaces from the provided. the actual list will resolve lazily.
        let mixinInterfaces: string[] = [];
        const mixins: string[] = getState(pluginDevice, ScryptedInterfaceProperty.mixins) || [];
        if (mixins.length)
            mixinInterfaces.push(...getState(pluginDevice, ScryptedInterfaceProperty.interfaces) || []);
        mixinInterfaces.push(...providedInterfaces.slice());
        mixinInterfaces = [...new Set(mixinInterfaces)].sort();

        this.stateManager.setPluginDeviceState(pluginDevice, ScryptedInterfaceProperty.providedInterfaces, providedInterfaces);
        const interfacesChanged = this.stateManager.setPluginDeviceState(pluginDevice, ScryptedInterfaceProperty.interfaces, mixinInterfaces);
        this.stateManager.setPluginDeviceState(pluginDevice, ScryptedInterfaceProperty.info, device.info);
        this.stateManager.setPluginDeviceState(pluginDevice, ScryptedInterfaceProperty.providerId, provider?._id);
        this.stateManager.setPluginDeviceState(pluginDevice, ScryptedInterfaceProperty.providedName, providedName);
        this.stateManager.setPluginDeviceState(pluginDevice, ScryptedInterfaceProperty.providedType, providedType);
        if (isUsingDefaultType)
            this.stateManager.setPluginDeviceState(pluginDevice, ScryptedInterfaceProperty.type, getProvidedTypeOrDefault(pluginDevice));
        if (isUsingDefaultName)
            this.stateManager.setPluginDeviceState(pluginDevice, ScryptedInterfaceProperty.name, getProvidedNameOrDefault(pluginDevice));
        this.stateManager.setPluginDeviceState(pluginDevice, ScryptedInterfaceProperty.providedRoom, providedRoom);
        if (isUsingDefaultRoom)
            this.stateManager.setPluginDeviceState(pluginDevice, ScryptedInterfaceProperty.room, getProvidedRoomOrDefault(pluginDevice));
        // pluginDevice.state.model = device.model;

        const ret = this.notifyPluginDeviceDescriptorChanged(pluginDevice);

        if (newDevice) {
            const logger = this.getDeviceLogger(pluginDevice);
            logger.log('a', 'New Device Added.');
        }

        if (invalidate && interfacesChanged) {
            console.log('invalidating on request');
            this.invalidatePluginDevice(pluginDevice._id);
        }

        return ret;
    }

    notifyPluginDeviceDescriptorChanged(pluginDevice: PluginDevice) {
        const ret = this.datastore.upsert(pluginDevice);

        // the descriptor events should happen after everything is set, as it's an atomic operation.
        this.stateManager.updateDescriptor(pluginDevice);
        this.stateManager.notifyInterfaceEvent(pluginDevice, ScryptedInterface.ScryptedDevice, undefined);

        return ret;
    }

    async migrate(pluginDevice: PluginDevice) {
        if (pluginDevice.stateVersion !== 2 || !pluginDevice.state) {
            if (!pluginDevice.state) {
                pluginDevice.state = {};
            }

            pluginDevice.stateVersion = 2;
            // mixins used to be a non-stateful property on PluginDevice.
            setState(pluginDevice, ScryptedInterfaceProperty.mixins, (pluginDevice as any).mixins);
            this.datastore.upsert(pluginDevice);
        }
    }

    async start() {
        for await (const pluginDevice of this.datastore.getAll(PluginDevice)) {
            this.migrate(pluginDevice);

            this.pluginDevices[pluginDevice._id] = pluginDevice;
            let mixins: string[] = getState(pluginDevice, ScryptedInterfaceProperty.mixins) || [];
            if (mixins.includes(null) || mixins.includes(undefined)) {
                setState(pluginDevice, ScryptedInterfaceProperty.mixins, mixins.filter(e => !!e));
                this.datastore.upsert(pluginDevice);
            }
        }

        for await (const plugin of this.datastore.getAll(Plugin)) {
            this.runPlugin(plugin).catch(e => console.error('error starting plugin', plugin._id, e));
        }
    }
}
