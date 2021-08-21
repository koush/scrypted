import { Level } from './level';
import { PluginHost } from './plugin/plugin-host';
import cluster from 'cluster';
import { Device, EngineIOHandler, HttpRequest, HttpRequestHandler, OauthClient, ScryptedDevice, ScryptedInterface, ScryptedInterfaceProperty } from '@scrypted/sdk/types';
import { PluginDevice, PluginDeviceProxyHandler } from './plugin/plugin-device';
import { Plugin, ScryptedAlert } from './db-types';
import { getState, ScryptedStateManager, setState } from './state';
import { Request, Response, Router } from 'express';
import { createResponseInterface } from './http-interfaces';
import bodyParser from 'body-parser';
import http from 'http';
import https from 'https';
import express from 'express';
import { LogEntry, Logger, makeAlertId } from './logger';
import { getDisplayName, getDisplayRoom, getDisplayType, getProvidedNameOrDefault, getProvidedRoomOrDefault, getProvidedTypeOrDefault } from './infer-defaults';
import { URL } from "url";
import qs from "query-string";
import { PluginComponent } from './component/plugin';
import { Server as WebSocketServer } from "ws";

interface DeviceProxyPair {
    handler: PluginDeviceProxyHandler;
    proxy: ScryptedDevice;
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
            this.endpointHandler(req, res, false, true,this.handleEngineIOEndpoint.bind(this))
        });

        // stringify all http endpoints
        app.all(['/endpoint/@:owner/:pkg/public', '/endpoint/@:owner/:pkg/public/*', '/endpoint/:pkg', '/endpoint/:pkg/*'], bodyParser.text());

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

            this.stateManager.notifyInterfaceEvent(null, 'Logger' as any, null, logEntry, true);
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
            res.end();
        }
    }

    endpointHandler(req: Request, res: Response, isPublicEndpoint: boolean, isEngineIOEndpoint: boolean,
        handler: (req: Request, res: Response, endpointRequest: HttpRequest, pluginHost: PluginHost, pluginDevice: PluginDevice) => void) {

        if (!isPublicEndpoint && !res.locals.username) {
            res.status(401);
            res.send('Not logged in');
            return;
        }

        const { owner, pkg } = req.params;
        let endpoint = pkg;
        if (owner)
            endpoint = `@${owner}/${endpoint}`;

        const pluginHost = this.plugins[endpoint] ?? this.getPluginHostForDeviceId(endpoint);
        const pluginDevice = this.findPluginDevice(endpoint) ?? this.findPluginDeviceById(endpoint);
        if (!pluginHost || !pluginDevice) {
            if (req.headers.connection?.toLowerCase() === 'upgrade' && (req.headers.upgrade?.toLowerCase() !== 'websocket' || !pluginDevice.state.interfaces.value.includes(ScryptedInterface.EngineIOHandler))) {
                const socket = res.socket;
                socket.write('HTTP/1.1 404 Not Found\r\n' +
                    '\r\n');
                socket.destroy();
                return;
            }
            else if (!pluginDevice.state.interfaces.value.includes(ScryptedInterface.HttpRequestHandler)) {
                res.writeHead(404);
                res.end()
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

        if (!isEngineIOEndpoint && req.headers.connection?.toLowerCase() === 'upgrade') {
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
                        self.stateManager.notifyInterfaceEvent(null, 'Logger' as any, null, null, true);
                    }
                    async clearAlerts() {
                        await self.datastore.removeAll(ScryptedAlert);
                        self.stateManager.notifyInterfaceEvent(null, 'Logger' as any, null, null, true);
                    }
                }
                return new Alerts();
        }
    }

    async handleEngineIOEndpoint(req: Request, res: Response, endpointRequest: HttpRequest, pluginHost: PluginHost, pluginDevice: PluginDevice) {
        (req as any).scrypted = {
            endpointRequest,
            pluginDevice,
        };
        if (req.headers.upgrade)
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
            res.end(e.toString());
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

    async installPlugin(plugin: Plugin, debug?: boolean): Promise<PluginHost> {
        await this.killPlugin(plugin);

        await this.upsertDevice(plugin._id, plugin.packageJson.scrypted);
        const pluginDevices = this.findPluginDevices(plugin._id);
        for (const pluginDevice of pluginDevices) {
            this.invalidatePluginDevice(pluginDevice._id);
        }

        if (debug) {
            cluster.setupMaster({
                silent: true,
                execArgv: ['--inspect', '-r', 'ts-node/register'],
            });
        }
        else {
            cluster.setupMaster({
                silent: true,
                execArgv: ['-r', 'ts-node/register'],
            });
        }

        const pluginHost = new PluginHost(this, plugin);
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
        return Object.values(this.pluginDevices).find(device => device._id === id);
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
    }

    upsertDevice(pluginId: string, device: Device): Promise<PluginDevice> {
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

        const providedInterfaces = device.interfaces || [];
        // assure final mixin resolved interface list has at least all the
        // interfaces from the provided. the actual list will resolve lazily.
        let mixinInterfaces = providedInterfaces.slice();
        mixinInterfaces.push(...getState(pluginDevice, ScryptedInterfaceProperty.interfaces) || []);
        mixinInterfaces = [...new Set(mixinInterfaces)];

        setState(pluginDevice, ScryptedInterfaceProperty.providedInterfaces, providedInterfaces);
        setState(pluginDevice, ScryptedInterfaceProperty.interfaces, mixinInterfaces);
        setState(pluginDevice, ScryptedInterfaceProperty.metadata, device.metadata);
        setState(pluginDevice, ScryptedInterfaceProperty.component, null);
        setState(pluginDevice, ScryptedInterfaceProperty.providerId, provider?._id);
        setState(pluginDevice, ScryptedInterfaceProperty.providedName, providedName);
        setState(pluginDevice, ScryptedInterfaceProperty.providedType, providedType);
        if (isUsingDefaultType)
            setState(pluginDevice, ScryptedInterfaceProperty.type, getProvidedTypeOrDefault(pluginDevice));
        if (isUsingDefaultName)
            setState(pluginDevice, ScryptedInterfaceProperty.name, getProvidedNameOrDefault(pluginDevice));
        setState(pluginDevice, ScryptedInterfaceProperty.providedRoom, providedRoom);
        if (isUsingDefaultRoom)
            setState(pluginDevice, ScryptedInterfaceProperty.room, getProvidedRoomOrDefault(pluginDevice));
        // pluginDevice.state.model = device.model;

        console.log('upsert', pluginDevice);

        const ret = this.datastore.upsert(pluginDevice);

        // the descriptor events should happen after everything is set, as it's an atomic operation.
        this.stateManager.updateDescriptor(pluginDevice);
        this.stateManager.notifyInterfaceEvent(pluginDevice, ScryptedInterface.ScryptedDevice, undefined, undefined, true);

        if (newDevice) {
            const logger = this.getDeviceLogger(pluginDevice);
            logger.log('a', 'New Device Added.');
        }

        return ret;
    }

    async start() {
        for await (const pluginDevice of this.datastore.getAll(PluginDevice)) {
            this.pluginDevices[pluginDevice._id] = pluginDevice as PluginDevice;
            if (pluginDevice.mixins?.includes(null)) {
                pluginDevice.mixins = pluginDevice.mixins.filter(e => e);
                this.datastore.upsert(pluginDevice);
            }
        }

        for await (const plugin of this.datastore.getAll(Plugin)) {
            this.installPlugin(plugin)
        }
    }
}
