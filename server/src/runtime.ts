import { Level } from './level';
import { PluginHost } from './plugin/plugin-host';
import { ScryptedNativeId, Device, EngineIOHandler, HttpRequest, HttpRequestHandler, OauthClient, PushHandler, ScryptedDevice, ScryptedInterface, ScryptedInterfaceProperty, DeviceInformation } from '@scrypted/types';
import { PluginDeviceProxyHandler } from './plugin/plugin-device';
import { Plugin, PluginDevice, ScryptedAlert } from './db-types';
import { getState, ScryptedStateManager, setState } from './state';
import { Request, Response } from 'express';
import { createResponseInterface } from './http-interfaces';
import http, { ServerResponse } from 'http';
import https from 'https';
import express from 'express';
import { LogEntry, Logger, makeAlertId } from './logger';
import { getDisplayName, getDisplayRoom, getDisplayType, getProvidedNameOrDefault, getProvidedRoomOrDefault, getProvidedTypeOrDefault } from './infer-defaults';
import { URL } from "url";
import qs from "query-string";
import { PluginComponent } from './services/plugin';
import WebSocket, { Server as WebSocketServer } from "ws";
import axios from 'axios';
import tar from 'tar';
import { once } from 'events';
import { PassThrough } from 'stream';
import { PluginDebug } from './plugin/plugin-debug';
import { getIpAddress, SCRYPTED_INSECURE_PORT, SCRYPTED_SECURE_PORT } from './server-settings';
import semver from 'semver';
import { ServiceControl } from './services/service-control';
import { Alerts } from './services/alerts';
import { Info } from './services/info';
import io from 'engine.io';
import { spawn as ptySpawn } from 'node-pty';
import rimraf from 'rimraf';
import { getPluginVolume } from './plugin/plugin-volume';
import { PluginHttp } from './plugin/plugin-http';
import AdmZip from 'adm-zip';
import path from 'path';

interface DeviceProxyPair {
    handler: PluginDeviceProxyHandler;
    proxy: ScryptedDevice;
}

const MIN_SCRYPTED_CORE_VERSION = 'v0.0.217';
const PLUGIN_DEVICE_STATE_VERSION = 2;

interface HttpPluginData {
    pluginHost: PluginHost;
    pluginDevice: PluginDevice
}

export class ScryptedRuntime extends PluginHttp<HttpPluginData> {
    datastore: Level;
    plugins: { [id: string]: PluginHost } = {};
    pluginDevices: { [id: string]: PluginDevice } = {};
    devices: { [id: string]: DeviceProxyPair } = {};
    stateManager = new ScryptedStateManager(this);
    logger = new Logger(this, '', 'Scrypted');
    devicesLogger = this.logger.getLogger('device', 'Devices');
    wss = new WebSocketServer({ noServer: true });
    wsAtomic = 0;
    shellio = io(undefined, {
        pingTimeout: 120000,
    });

    constructor(datastore: Level, insecure: http.Server, secure: https.Server, app: express.Application) {
        super(app);
        this.datastore = datastore;
        this.app = app;

        app.disable('x-powered-by');

        app.get('/web/oauth/callback', (req, res) => {
            this.oauthCallback(req, res);
        });

        app.all('/engine.io/shell', (req, res) => {
            this.shellHandler(req, res);
        });
        this.shellio.on('connection', connection => {
            const cp = ptySpawn(process.env.SHELL, [], {

            });
            cp.onData(data => connection.send(data));
            connection.on('message', message => cp.write(message.toString()));
            connection.on('close', () => cp.kill());
        })

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
            this.logger.purge(Date.now() - 48 * 60 * 60 * 1000);
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

    async getPluginForEndpoint(endpoint: string): Promise<HttpPluginData> {
        let pluginHost = this.plugins[endpoint] ?? this.getPluginHostForDeviceId(endpoint);
        if (endpoint === '@scrypted/core') {
            // enforce a minimum version on @scrypted/core
            if (!pluginHost || semver.lt(pluginHost.packageJson.version, MIN_SCRYPTED_CORE_VERSION)) {
                try {
                    pluginHost = await this.installNpm('@scrypted/core');
                }
                catch (e) {
                    console.error('@scrypted/core auto install failed', e);
                }
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

    async shellHandler(req: Request, res: Response) {
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

        if (!res.locals.username) {
            end(401, 'Not Authorized');
            return;
        }

        if ((req as any).upgradeHead)
            this.shellio.handleUpgrade(req, res.socket, (req as any).upgradeHead)
        else
            this.shellio.handleRequest(req, res);
    }

    async getEndpointPluginData(endpoint: string, isUpgrade: boolean, isEngineIOEndpoint: boolean): Promise<HttpPluginData> {
        const ret = await this.getPluginForEndpoint(endpoint);
        const { pluginDevice } = ret;

        // check if upgrade requests can be handled. must be websocket.
        if (isUpgrade) {
            if (!pluginDevice?.state.interfaces.value.includes(ScryptedInterface.EngineIOHandler)) {
                return;
            }
        }
        else {
            if (!isEngineIOEndpoint && !pluginDevice?.state.interfaces.value.includes(ScryptedInterface.HttpRequestHandler)) {
                return;
            }
        }

        return ret;
    }

    async handleWebSocket(endpoint: string, httpRequest: HttpRequest, ws: WebSocket, pluginData: HttpPluginData): Promise<void> {
        const { pluginDevice } = pluginData;

        const handler = this.getDevice<EngineIOHandler>(pluginDevice._id);
        const id = 'ws-' + this.wsAtomic++;
        const pluginHost = this.plugins[endpoint] ?? this.getPluginHostForDeviceId(endpoint);
        if (!pluginHost) {
            ws.close();
            return;
        }
        pluginHost.ws[id] = ws;

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

        await handler.onConnection(httpRequest, `ws://${id}`);
    }

    async getComponent(componentId: string): Promise<any> {
        switch (componentId) {
            case 'SCRYPTED_IP_ADDRESS':
                return getIpAddress();
            case 'SCRYPTED_INSECURE_PORT':
                return SCRYPTED_INSECURE_PORT;
            case 'SCRYPTED_SECURE_PORT':
                return SCRYPTED_SECURE_PORT;
            case 'info':
                return new Info();
            case 'plugins':
                return new PluginComponent(this);
            case 'service-control':
                return new ServiceControl(this);
            case 'logger':
                return this.logger;
            case 'alerts':
                return new Alerts(this);
        }
    }

    async getPackageJson(pluginId: string) {
        let packageJson;
        if (this.plugins[pluginId]) {
            packageJson = this.plugins[pluginId].packageJson;
        }
        else {
            const plugin = await this.datastore.tryGet(Plugin, pluginId);
            packageJson = plugin.packageJson;
        }
        return packageJson;
    }

    handleEngineIOEndpoint(req: Request, res: ServerResponse, endpointRequest: HttpRequest, pluginData: HttpPluginData) {
        const { pluginHost, pluginDevice } = pluginData;

        if (!pluginHost || !pluginDevice) {
            console.error('plugin does not exist or is still starting up.');
            res.writeHead(500);
            res.end();
            return;
        }

        (req as any).scrypted = {
            endpointRequest,
            pluginDevice,
        };
        if ((req as any).upgradeHead)
            pluginHost.io.handleUpgrade(req, res.socket, (req as any).upgradeHead)
        else
            pluginHost.io.handleRequest(req, res);
    }

    handleRequestEndpoint(req: Request, res: Response, endpointRequest: HttpRequest, pluginData: HttpPluginData) {
        const { pluginHost, pluginDevice } = pluginData;
        const handler = this.getDevice<HttpRequestHandler>(pluginDevice._id);
        if (handler.interfaces.includes(ScryptedInterface.EngineIOHandler) && req.headers.connection === 'upgrade' && req.headers.upgrade?.toLowerCase() === 'websocket') {
            this.wss.handleUpgrade(req, req.socket, null, ws => {
                console.log(ws);
            });
        }

        const filesPath = path.join(getPluginVolume(pluginHost.pluginId), 'files');
        handler.onRequest(endpointRequest, createResponseInterface(res, pluginHost.unzippedPath, filesPath));
    }

    killPlugin(pluginId: string) {
        const existing = this.plugins[pluginId];
        if (existing) {
            delete this.plugins[pluginId];
            existing.kill();
        }
    }

    // should this be async?
    invalidatePluginDevice(id: string) {
        const proxyPair = this.devices[id];
        if (!proxyPair)
            return;
        proxyPair.handler.invalidate();
        return proxyPair;
    }

    // should this be async?
    rebuildPluginDeviceMixinTable(id: string) {
        const proxyPair = this.devices[id];
        if (!proxyPair)
            return;
        proxyPair.handler.rebuildMixinTable();
        return proxyPair;
    }

    invalidateMixins(ids: Set<string>) {
        const ret = new Set<string>();
        const remaining = [...ids];

        // first pass:
        // for every id, find anything it is acting on as a mixin, and clear out the entry.
        while (remaining.length) {
            const id = remaining.pop();

            for (const device of Object.values(this.devices)) {
                const foundIndex = device.handler?.mixinTable?.findIndex(mt => mt.mixinProviderId === id);
                if (foundIndex === -1 || foundIndex === undefined)
                    continue;

                const did = device.handler.id;
                if (!ret.has(did)) {
                    // add this to the list of mixin providers that need to be rebuilt
                    ret.add(did);
                    remaining.push(did);
                }

                // if it is the last entry, that means it is the device itself.
                // can this happen? i don't think it is possible. mixin provider id would be undefined.
                if (foundIndex === device.handler.mixinTable.length - 1) {
                    console.warn('attempt to invalidate mixin on actual device?');
                    continue;
                }

                const removed = device.handler.mixinTable.splice(0, foundIndex + 1);
                for (const entry of removed) {
                    console.log('invalidating mixin', device.handler.id, entry.mixinProviderId);
                    device.handler.invalidateEntry(entry);
                }
            }
        }

        // second pass:
        // rebuild the mixin tables.
        for (const id of ret) {
            const device = this.devices[id];
            device.handler.rebuildMixinTable();
        }

        return ret;
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
        const device: Device = Object.assign({}, plugin.packageJson.scrypted, {
            info: {
                manufacturer: plugin.packageJson.name,
                version: plugin.packageJson.version,
            }
        } as Device);
        try {
            if (!device.interfaces.includes(ScryptedInterface.Readme)) {
                const zipData = Buffer.from(plugin.zip, 'base64');
                const adm = new AdmZip(zipData);
                const entry = adm.getEntry('README.md');
                if (entry) {
                    device.interfaces = device.interfaces.slice();
                    device.interfaces.push(ScryptedInterface.Readme);
                }
            }
        }
        catch (e) {
        }
        this.upsertDevice(plugin._id, device);
        return this.runPlugin(plugin, pluginDebug);
    }

    setupPluginHostAutoRestart(pluginHost: PluginHost) {
        pluginHost.worker.once('exit', () => {
            if (pluginHost.killed)
                return;
            pluginHost.kill();
            const timeout = 60000;
            console.error(`plugin unexpectedly exited, restarting in ${timeout}ms`, pluginHost.pluginId);
            setTimeout(async () => {
                const existing = this.plugins[pluginHost.pluginId];
                if (existing !== pluginHost) {
                    console.log('scheduled plugin restart cancelled, plugin was restarted by user', pluginHost.pluginId);
                    return;
                }

                const plugin = await this.datastore.tryGet(Plugin, pluginHost.pluginId);
                if (!plugin) {
                    console.log('scheduled plugin restart cancelled, plugin no longer exists', pluginHost.pluginId);
                    return;
                }

                try {
                    this.runPlugin(plugin);
                }
                catch (e) {
                    console.error('error restarting plugin', plugin._id, e);
                }
            }, timeout);
        });
    }

    runPlugin(plugin: Plugin, pluginDebug?: PluginDebug) {
        const pluginId = plugin._id;
        this.killPlugin(pluginId);

        const pluginDevices = this.findPluginDevices(pluginId);
        for (const pluginDevice of pluginDevices) {
            this.invalidatePluginDevice(pluginDevice._id);
        }

        const pluginHost = new PluginHost(this, plugin, pluginDebug);
        this.setupPluginHostAutoRestart(pluginHost);
        this.plugins[pluginId] = pluginHost;

        return pluginHost;
    }

    findPluginDevice?(pluginId: string, nativeId?: ScryptedNativeId): PluginDevice {
        // JSON stringify over rpc turns undefined into null.
        if (nativeId === null)
            nativeId = undefined;
        return Object.values(this.pluginDevices).find(device => device.pluginId === pluginId && device.nativeId == nativeId);
    }

    findPluginDeviceById(id: string): PluginDevice {
        return this.pluginDevices[id];
    }

    findPluginDevices(pluginId: string): PluginDevice[] {
        return Object.values(this.pluginDevices).filter(e => e.state && e.pluginId === pluginId)
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
        // delete any devices provided by this device
        const providedDevices = Object.values(this.pluginDevices).filter(pluginDevice => getState(pluginDevice, ScryptedInterfaceProperty.providerId) === device._id);
        for (const provided of providedDevices) {
            if (provided === device)
                continue;
            await this.removeDevice(provided);
        }
        device.state = undefined;

        this.invalidatePluginDevice(device._id);
        delete this.pluginDevices[device._id];
        await this.datastore.remove(device);
        this.stateManager.removeDevice(device._id);

        // if this device is acting as a mixin on anything, can now remove invalidate it.
        // when the mixin table is rebuilt, it will be automatically ignore and remove the dangling mixin.
        this.invalidateMixins(new Set([device._id]));

        // if the device is a plugin, kill and remove the plugin as well.
        if (!device.nativeId) {
            this.killPlugin(device.pluginId);
            await this.datastore.removeId(Plugin, device.pluginId);
            rimraf.sync(getPluginVolume(device.pluginId));
        }
        else {
            try {
                // notify the plugin that a device was removed.
                const plugin = this.plugins[device.pluginId];
                await plugin.remote.setNativeId(device.nativeId, undefined, undefined);
            }
            catch (e) {
                // may throw if the plugin is killed, etc.
                console.warn('error while reporting device removal to plugin remote', e);
            }
        }
    }

    upsertDevice(pluginId: string, device: Device) {
        // JSON stringify over rpc turns undefined into null.
        if (device.nativeId === null)
            device.nativeId = undefined;
        let newDevice = false;
        let pluginDevice = this.findPluginDevice(pluginId, device.nativeId);
        if (!pluginDevice) {
            pluginDevice = new PluginDevice(this.datastore.nextId().toString());
            pluginDevice.stateVersion = PLUGIN_DEVICE_STATE_VERSION;
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

        let providedInterfaces = device.interfaces.slice();
        if (!device.nativeId)
            providedInterfaces.push(ScryptedInterface.ScryptedPlugin);
        else
            providedInterfaces = providedInterfaces.filter(iface => iface !== ScryptedInterface.ScryptedPlugin);
        providedInterfaces = PluginDeviceProxyHandler.sortInterfaces(providedInterfaces);
        // assure final mixin resolved interface list has at least all the
        // interfaces from the provided. the actual list will resolve lazily.
        let mixinInterfaces: string[] = [];
        const mixins: string[] = getState(pluginDevice, ScryptedInterfaceProperty.mixins) || [];
        if (mixins.length)
            mixinInterfaces.push(...getState(pluginDevice, ScryptedInterfaceProperty.interfaces) || []);
        mixinInterfaces.push(...providedInterfaces.slice());
        mixinInterfaces = PluginDeviceProxyHandler.sortInterfaces(mixinInterfaces);

        let interfacesChanged = this.stateManager.setPluginDeviceState(pluginDevice, ScryptedInterfaceProperty.providedInterfaces, providedInterfaces);
        interfacesChanged = this.stateManager.setPluginDeviceState(pluginDevice, ScryptedInterfaceProperty.interfaces, mixinInterfaces)
            || interfacesChanged;
        if (device.info !== undefined)
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

        const ret = this.notifyPluginDeviceDescriptorChanged(pluginDevice);

        if (newDevice) {
            const logger = this.getDeviceLogger(pluginDevice);
            logger.log('a', 'New Device Added.');
        }

        return {
            pluginDevicePromise: ret,
            interfacesChanged,
        };
    }

    notifyPluginDeviceDescriptorChanged(pluginDevice: PluginDevice) {
        const ret = this.datastore.upsert(pluginDevice);

        // the descriptor events should happen after everything is set, as it's an atomic operation.
        this.stateManager.updateDescriptor(pluginDevice);
        this.stateManager.notifyInterfaceEvent(pluginDevice, ScryptedInterface.ScryptedDevice, undefined);

        return ret;
    }

    killall() {
        for (const host of Object.values(this.plugins)) {
            host?.kill();
        }
        process.exit();
    }

    async start() {
        // catch ctrl-c
        process.on('SIGINT', () => this.killall());
        // catch kill
        process.on('SIGTERM', () => this.killall());

        for await (const pluginDevice of this.datastore.getAll(PluginDevice)) {
            // this may happen due to race condition around deletion/update. investigate.
            if (!pluginDevice.state) {
                this.datastore.remove(pluginDevice);
                continue;
            }

            this.pluginDevices[pluginDevice._id] = pluginDevice;
            let mixins: string[] = getState(pluginDevice, ScryptedInterfaceProperty.mixins) || [];

            let dirty = false;
            if (mixins.includes(null) || mixins.includes(undefined)) {
                dirty = true;
                setState(pluginDevice, ScryptedInterfaceProperty.mixins, mixins.filter(e => !!e));
            }

            const interfaces: string[] = getState(pluginDevice, ScryptedInterfaceProperty.providedInterfaces);
            if (!pluginDevice.nativeId && !interfaces.includes(ScryptedInterface.ScryptedPlugin)) {
                dirty = true;
                interfaces.push(ScryptedInterface.ScryptedPlugin);
                setState(pluginDevice, ScryptedInterfaceProperty.providedInterfaces, PluginDeviceProxyHandler.sortInterfaces(interfaces));
            }

            if (dirty) {
                this.datastore.upsert(pluginDevice);
            }
        }

        for await (const plugin of this.datastore.getAll(Plugin)) {
            try {
                const pluginDevice = this.findPluginDevice(plugin._id);
                setState(pluginDevice, ScryptedInterfaceProperty.info, {
                    manufacturer: plugin.packageJson.name,
                    version: plugin.packageJson.version,
                } as DeviceInformation);
                this.runPlugin(plugin);
            }
            catch (e) {
                console.error('error starting plugin', plugin._id, e);
            }
        }
    }
}
