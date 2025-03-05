import { Device, DeviceInformation, DeviceProvider, EngineIOHandler, HttpRequest, HttpRequestHandler, ScryptedDevice, ScryptedInterface, ScryptedInterfaceMethod, ScryptedInterfaceProperty, ScryptedNativeId, ScryptedUser as SU } from '@scrypted/types';
import AdmZip from 'adm-zip';
import crypto from 'crypto';
import * as io from 'engine.io';
import { once } from 'events';
import express, { Request, Response } from 'express';
import { ParamsDictionary } from 'express-serve-static-core';
import fs from 'fs';
import http, { ServerResponse } from 'http';
import https from 'https';
import net from 'net';
import path from 'path';
import { ParsedQs } from 'qs';
import semver from 'semver';
import { Parser as TarParser } from 'tar';
import { URL } from "url";
import WebSocket, { Server as WebSocketServer } from "ws";
import { computeClusterObjectHash } from './cluster/cluster-hash';
import { isClusterAddress } from './cluster/cluster-setup';
import { ClusterObject } from './cluster/connect-rpc-object';
import { Plugin, PluginDevice, ScryptedAlert, ScryptedUser } from './db-types';
import { httpFetch } from './fetch/http-fetch';
import { createResponseInterface } from './http-interfaces';
import { getDisplayName, getDisplayRoom, getDisplayType, getProvidedNameOrDefault, getProvidedRoomOrDefault, getProvidedTypeOrDefault } from './infer-defaults';
import { IOServer } from './io';
import Level from './level';
import { LogEntry, Logger, makeAlertId } from './logger';
import { getMixins, hasMixinCycle } from './mixin/mixin-cycle';
import { AccessControls } from './plugin/acl';
import { PluginDebug } from './plugin/plugin-debug';
import { PluginDeviceProxyHandler } from './plugin/plugin-device';
import { PluginHost, UnsupportedRuntimeError } from './plugin/plugin-host';
import { isConnectionUpgrade, PluginHttp } from './plugin/plugin-http';
import { WebSocketConnection } from './plugin/plugin-remote-websocket';
import { getPluginVolume } from './plugin/plugin-volume';
import { getBuiltinRuntimeHosts } from './plugin/runtime/runtime-host';
import { timeoutPromise } from './promise-utils';
import { RunningClusterWorker } from './scrypted-cluster-main';
import { getIpAddress, SCRYPTED_INSECURE_PORT, SCRYPTED_SECURE_PORT } from './server-settings';
import { AddressSettings } from './services/addresses';
import { Alerts } from './services/alerts';
import { Backup } from './services/backup';
import { ClusterForkService } from './services/cluster-fork';
import { CORSControl } from './services/cors';
import { EnvControl } from './services/env';
import { Info } from './services/info';
import { getNpmPackageInfo, PluginComponent } from './services/plugin';
import { ServiceControl } from './services/service-control';
import { UsersService } from './services/users';
import { getState, ScryptedStateManager, setState } from './state';

interface DeviceProxyPair {
    handler: PluginDeviceProxyHandler;
    proxy: ScryptedDevice;
}

const MIN_SCRYPTED_CORE_VERSION = 'v0.2.6';
const PLUGIN_DEVICE_STATE_VERSION = 2;

interface HttpPluginData {
    pluginHost: PluginHost;
    pluginDevice: PluginDevice
}

export class ScryptedRuntime extends PluginHttp<HttpPluginData> {
    clusterId = crypto.randomBytes(3).toString('hex');
    clusterSecret = process.env.SCRYPTED_CLUSTER_SECRET || crypto.randomBytes(16).toString('hex');
    clusterWorkers = new Map<string, RunningClusterWorker>();
    serverClusterWorkerId: string;
    plugins: { [id: string]: PluginHost } = {};
    pluginDevices: { [id: string]: PluginDevice } = {};
    devices: { [id: string]: DeviceProxyPair } = {};
    stateManager = new ScryptedStateManager(this);
    logger = new Logger(this, '', 'Scrypted');
    devicesLogger = this.logger.getLogger('device', 'Devices');
    wss = new WebSocketServer({ noServer: true });
    wsAtomic = 0;
    connectRPCObjectIO: IOServer = new io.Server({
        pingTimeout: 120000,
        perMessageDeflate: true,
        cors: (req, callback) => {
            const header = this.getAccessControlAllowOrigin(req.headers);
            callback(undefined, {
                origin: header,
                credentials: true,
            })
        },
    });
    pluginComponent = new PluginComponent(this);
    serviceControl = new ServiceControl();
    alerts = new Alerts(this);
    corsControl = new CORSControl(this);
    addressSettings = new AddressSettings(this);
    usersService = new UsersService(this);
    clusterFork = new ClusterForkService(this);
    envControl = new EnvControl();
    info = new Info();
    backup = new Backup(this);
    pluginHosts = getBuiltinRuntimeHosts();

    constructor(public mainFilename: string, public datastore: Level, app: express.Application) {
        super(app);
        // ensure that all the users are loaded from the db.
        this.usersService.getAllUsers();

        app.disable('x-powered-by');

        this.addMiddleware();

        app.all('/engine.io/connectRPCObject', (req, res) => this.connectRPCObjectHandler(req, res));

        /*
        * Handle incoming connections that will be
        * proxied to a connectRPCObject socket.
        *
        * Note that the clusterObject hash must be
        * verified before connecting to the target port.
        */
        this.connectRPCObjectIO.on('connection', connection => {
            try {
                const clusterObject: ClusterObject = JSON.parse((connection.request as Request).query.clusterObject as string);
                const sha256 = computeClusterObjectHash(clusterObject, this.clusterSecret);
                if (sha256 != clusterObject.sha256) {
                    connection.send({
                        error: 'invalid signature'
                    });
                    connection.close();
                    return;
                }

                let address = clusterObject.address;
                if (isClusterAddress(address))
                    address = '127.0.0.1';
                const socket = net.connect({
                    port: clusterObject.port,
                    host: address,
                });
                socket.on('error', () => connection.close());
                socket.on('close', () => connection.close());
                socket.on('data', data => connection.send(data));
                connection.on('close', () => socket.destroy());
                connection.on('message', message => {
                    if (typeof message !== 'string') {
                        socket.write(message);
                    }
                    else {
                        console.warn('unexpected string data on engine.io rpc connection. terminating.')
                        connection.close();
                    }
                });
            } catch {
                connection.close();
            }
        });

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

    checkUpgrade(req: express.Request<ParamsDictionary, any, any, ParsedQs, Record<string, any>>, res: express.Response<any, Record<string, any>>, pluginData: HttpPluginData): void {
        // pluginData.pluginHost.io.
        const { sid } = req.query;
        const client = (pluginData.pluginHost.io as any).clients[sid as string];
        if (client) {
            res.locals.username = 'existing-io-session';
        }
    }

    addAccessControlHeaders(req: http.IncomingMessage, res: http.ServerResponse) {
        res.setHeader('Vary', 'Origin,Referer');
        const header = this.getAccessControlAllowOrigin(req.headers);
        if (header) {
            res.setHeader('Access-Control-Allow-Origin', header);
        }
        res.setHeader("Access-Control-Allow-Credentials", "true");
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With, Access-Control-Request-Method');
    }

    getAccessControlAllowOrigin(headers: http.IncomingHttpHeaders) {
        let { origin, referer } = headers;
        if (!origin && referer) {
            try {
                const u = new URL(headers.referer)
                origin = u.origin;
            }
            catch (e) {
                return;
            }
        }
        if (!origin)
            return;
        const servers: string[] = process.env.SCRYPTED_ACCESS_CONTROL_ALLOW_ORIGINS?.split(',') || [];
        servers.push(...Object.values(this.corsControl.origins).flat());
        if (!servers.includes(origin))
            return;

        return origin;
    }

    getDeviceLogger(device: PluginDevice): Logger {
        if (!device)
            return;
        return this.devicesLogger.getLogger(device._id, getState(device, ScryptedInterfaceProperty.name));
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

    async connectRPCObjectHandler(req: Request, res: Response) {
        const isUpgrade = isConnectionUpgrade(req.headers);

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

        const reqany = req as any;
        if ((req as any).upgradeHead)
            this.connectRPCObjectIO.handleUpgrade(reqany, res.socket, reqany.upgradeHead)
        else
            this.connectRPCObjectIO.handleRequest(reqany, res);
    }

    async getEndpointPluginData(req: Request, endpoint: string, isUpgrade: boolean, isEngineIOEndpoint: boolean): Promise<HttpPluginData> {
        const ret = await this.getPluginForEndpoint(endpoint);
        if (req.url.indexOf('/engine.io/api') !== -1)
            return ret;

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

        // @ts-expect-error
        await handler.onConnection(httpRequest, new WebSocketConnection(`ws://${id}`, {
            send(message) {
                ws.send(message);
            },
            close(message) {
                ws.close();
            },
        }));
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
                return this.info;
            case 'plugins':
                return this.pluginComponent;
            case 'service-control':
                return this.serviceControl;
            case 'logger':
                return this.logger;
            case 'alerts':
                return this.alerts;
            case 'cors':
                return this.corsControl;
            case 'addresses':
                return this.addressSettings;
            case "users":
                return this.usersService;
            case 'backup':
                return this.backup;
            case 'cluster-fork':
                return this.clusterFork;
            case 'env-control':
                return this.envControl;
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

    async getAccessControls(username: string) {
        if (!username)
            return;

        const user = await this.datastore.tryGet(ScryptedUser, username);
        if (user?.aclId) {
            const accessControl = this.getDevice<SU>(user.aclId);
            const acls = await accessControl.getScryptedUserAccessControl();
            if (!acls)
                return;
            return new AccessControls(acls);
        }
    }

    async handleEngineIOEndpoint(req: Request, res: ServerResponse & { locals: any }, endpointRequest: HttpRequest, pluginData: HttpPluginData) {
        const { pluginHost, pluginDevice } = pluginData;

        const { username } = res.locals;
        let accessControls: AccessControls;

        try {
            accessControls = await this.getAccessControls(username);
            if (accessControls?.shouldRejectMethod(pluginDevice._id, ScryptedInterfaceMethod.onConnection))
                accessControls.deny();
        }
        catch (e) {
            res.writeHead(401);
            res.end();
            return;
        }

        if (!pluginHost || !pluginDevice) {
            console.error('plugin does not exist or is still starting up.');
            res.writeHead(500);
            res.end();
            return;
        }

        const reqany = req as any;

        reqany.scrypted = {
            endpointRequest,
            pluginDevice,
            accessControls,
        };

        if ((req as any).upgradeHead)
            pluginHost.io.handleUpgrade(reqany, res.socket, reqany.upgradeHead)
        else
            pluginHost.io.handleRequest(reqany, res);
    }

    handleRequestEndpoint(req: Request, res: Response, endpointRequest: HttpRequest, pluginData: HttpPluginData) {
        const { pluginHost, pluginDevice } = pluginData;
        const handler = this.getDevice<HttpRequestHandler>(pluginDevice._id);
        if (handler.interfaces.includes(ScryptedInterface.EngineIOHandler) && isConnectionUpgrade(req.headers) && req.headers.upgrade?.toLowerCase() === 'websocket') {
            this.wss.handleUpgrade(req, req.socket, null, ws => {
                console.log(ws);
            });
        }

        const { pluginId } = pluginHost;
        const filesPath = path.join(getPluginVolume(pluginId), 'files');
        const ri = createResponseInterface(this, res, pluginHost.unzippedPath, filesPath);
        handler.onRequest(endpointRequest, ri)
            .catch(() => { })
            .finally(() => {
                if (!ri.sent) {
                    console.warn(pluginId, 'did not send a response before onRequest returned.');
                    ri.send(`Internal Plugin Error: ${pluginId}`, {
                        code: 500,
                    })
                }
            });
    }

    killPlugin(pluginId: string) {
        const existing = this.plugins[pluginId];
        if (existing) {
            delete this.plugins[pluginId];
            existing.kill();
        }
        this.invalidatePluginMixins(pluginId);
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

    invalidatePluginMixins(pluginId: string) {
        const deviceIds = new Set<string>(Object.values(this.pluginDevices).filter(d => d.pluginId === pluginId).map(d => d._id));
        this.invalidateMixins(deviceIds);
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

    async installNpm(pkg: string, version?: string, installedSet?: Set<string>): Promise<PluginHost> {
        if (!installedSet)
            installedSet = new Set();
        if (installedSet.has(pkg))
            return;
        installedSet.add(pkg);

        const registry = await getNpmPackageInfo(pkg);
        if (!version) {
            version = registry['dist-tags'].latest;
        }
        console.log('installing package', pkg, version);

        const { body: tarball } = await httpFetch({
            url: `${registry.versions[version].dist.tarball}`,
            // force ipv4 in case of busted ipv6.
            family: 4,
        });
        console.log('downloaded tarball', tarball?.length);
        try {
            const pp = new TarParser();
        }
        catch (e) {
            throw new Error(e);
        }
        const parse = new TarParser();
        const files: { [name: string]: Buffer } = {};

        parse.on('entry', async (entry: any) => {
            console.log('parsing entry', entry.path)
            const chunks: Buffer[] = [];
            entry.on('data', (data: Buffer) => chunks.push(data));

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

            const pluginDependencies: string[] = packageJson.scrypted.pluginDependencies || [];
            pluginDependencies.forEach(async (dep) => {
                try {
                    const depId = this.findPluginDevice(dep);
                    if (depId)
                        throw new Error('Plugin already installed.');
                    await this.installNpm(dep);
                }
                catch (e) {
                    console.log('Skipping', dep, ':', e.message);
                }
            });

            const npmPackage = packageJson.name;
            const plugin = await this.datastore.tryGet(Plugin, npmPackage) || new Plugin();

            plugin._id = npmPackage;
            plugin.packageJson = packageJson;
            plugin.zip = files['package/dist/plugin.zip'].toString('base64');
            await this.datastore.upsert(plugin);

            return this.installPlugin(plugin);
        })();

        parse.write(tarball);
        parse.end();
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

    setupPluginHostAutoRestart(pluginId: string, pluginHost?: PluginHost) {
        const logger = this.getDeviceLogger(this.findPluginDevice(pluginId));

        let timeout: NodeJS.Timeout;

        const restart = () => {
            if (timeout)
                return;

            const t = 60000;
            pluginHost?.kill();
            logger.log('e', `plugin ${pluginId} unexpectedly exited, restarting in ${t}ms`);

            timeout = setTimeout(async () => {
                timeout = undefined;
                const plugin = await this.datastore.tryGet(Plugin, pluginId);
                if (!plugin) {
                    logger.log('w', `scheduled plugin restart cancelled, plugin no longer exists ${pluginId}`);
                    return;
                }

                const existing = this.plugins[pluginId];
                if (existing && pluginHost && existing !== pluginHost && !existing.killed) {
                    logger.log('w', `scheduled plugin restart cancelled, plugin was restarted by user ${pluginId}`);
                    return;
                }

                try {
                    await this.runPlugin(plugin);
                }
                catch (e) {
                    logger.log('e', `error restarting plugin ${pluginId}`);
                    logger.log('e', e.toString());
                    restart();
                }
            }, t);
        };
        1
        if (pluginHost) {
            pluginHost.worker.once('error', restart);
            pluginHost.worker.once('exit', restart);
        }
        else {
            restart();
        }
    }

    loadPlugin(plugin: Plugin, pluginDebug?: PluginDebug) {
        const pluginId = plugin._id;
        try {
            this.killPlugin(pluginId);

            const pluginDevices = this.findPluginDevices(pluginId);
            for (const pluginDevice of pluginDevices) {
                this.invalidatePluginDevice(pluginDevice._id);
            }

            const pluginHost = new PluginHost(this, plugin, pluginDebug);
            this.plugins[pluginId] = pluginHost;
            this.setupPluginHostAutoRestart(pluginId, pluginHost);

            return pluginHost;
        }
        catch (e) {
            const logger = this.getDeviceLogger(this.findPluginDevice(pluginId));
            if (e instanceof UnsupportedRuntimeError) {
                logger.log('e', 'error loading plugin (not retrying)');
                logger.log('e', e.toString());
                throw e;
            }

            logger.log('e', 'error loading plugin (retrying...)');
            logger.log('e', e.toString());
            this.setupPluginHostAutoRestart(pluginId);
            throw e;
        }
    }

    probePluginDevices(plugin: Plugin) {
        const pluginId = plugin._id;
        const pluginDevices = this.findPluginDevices(pluginId);

        const pluginDeviceSet = new Set<string>();
        for (const pluginDevice of pluginDevices) {
            if (pluginDeviceSet.has(pluginDevice._id))
                continue;
            pluginDeviceSet.add(pluginDevice._id);
            this.getDevice(pluginDevice._id)?.probe().catch(() => { });
        }

        for (const pluginDevice of Object.values(this.pluginDevices)) {
            const { _id } = pluginDevice;
            if (pluginDeviceSet.has(_id))
                continue;
            for (const mixinId of getMixins(this, _id)) {
                if (pluginDeviceSet.has(mixinId)) {
                    this.getDevice(_id)?.probe().catch(() => { });
                }
            }
        }

    }

    async runPlugin(plugin: Plugin, pluginDebug?: PluginDebug) {
        const existingPluginHost = this.plugins[plugin._id];
        const killPromise = existingPluginHost?.worker?.killPromise;
        if (killPromise) {
            existingPluginHost?.kill();
            await timeoutPromise(5000, killPromise).catch(() => {
                console.warn('plugin worker did not exit in 5 seconds');
            });
        }

        const pluginHost = this.loadPlugin(plugin, pluginDebug);
        this.probePluginDevices(plugin);
        return pluginHost;
    }

    findPluginDevice(pluginId: string, nativeId?: ScryptedNativeId): PluginDevice {
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
        const providerId = device.state?.providerId?.value;
        device.state = undefined;

        this.invalidatePluginDevice(device._id);
        delete this.pluginDevices[device._id];
        delete this.devices[device._id];
        await this.datastore.remove(device);
        this.stateManager.removeDevice(device._id);

        // if this device is acting as a mixin on anything, can now remove invalidate it.
        // when the mixin table is rebuilt, it will be automatically ignore and remove the dangling mixin.
        this.invalidateMixins(new Set([device._id]));

        // if the device is a plugin, kill and remove the plugin as well.
        if (!device.nativeId) {
            this.killPlugin(device.pluginId);
            await this.datastore.removeId(Plugin, device.pluginId);
            await fs.promises.rm(getPluginVolume(device.pluginId), {
                recursive: true,
                force: true,
            });
        }
        else {
            try {
                // notify the plugin that a device was removed.
                const plugin = this.plugins[device.pluginId];
                await plugin.remote.setNativeId(device.nativeId, undefined, undefined);
                const provider = this.getDevice<DeviceProvider>(providerId);
                await provider?.releaseDevice(device._id, device.nativeId);
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
        let pluginDevice = this.findPluginDevice(pluginId, device.nativeId);
        if (!pluginDevice) {
            pluginDevice = new PluginDevice(this.datastore.nextId().toString());
            pluginDevice.stateVersion = PLUGIN_DEVICE_STATE_VERSION;
        }
        this.pluginDevices[pluginDevice._id] = pluginDevice;
        pluginDevice.pluginId = pluginId;
        pluginDevice.nativeId = device.nativeId;
        pluginDevice.state = pluginDevice.state || {};

        if (pluginDevice.state[ScryptedInterfaceProperty.nativeId]?.value !== pluginDevice.nativeId) {
            setState(pluginDevice, ScryptedInterfaceProperty.nativeId, pluginDevice.nativeId);
        }

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

        this.stateManager.setPluginDeviceState(pluginDevice, ScryptedInterfaceProperty.pluginId, pluginId);
        let interfacesChanged = this.stateManager.setPluginDeviceState(pluginDevice, ScryptedInterfaceProperty.providedInterfaces, providedInterfaces);
        interfacesChanged = this.stateManager.setPluginDeviceState(pluginDevice, ScryptedInterfaceProperty.interfaces, mixinInterfaces)
            || interfacesChanged;
        if (device.info !== undefined)
            this.stateManager.setPluginDeviceState(pluginDevice, ScryptedInterfaceProperty.info, device.info);
        const provider = this.findPluginDevice(pluginId, device.providerNativeId);
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

    kill() {
        for (const host of Object.values(this.plugins)) {
            host?.kill();
        }
    }

    exit() {
        this.kill();
        process.exit();
    }

    async start() {
        // catch ctrl-c
        process.on('SIGINT', () => this.exit());
        // catch kill
        process.on('SIGTERM', () => this.exit());

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

            const pluginId: string = getState(pluginDevice, ScryptedInterfaceProperty.pluginId);
            if (!pluginId) {
                dirty = true;
                setState(pluginDevice, ScryptedInterfaceProperty.pluginId, pluginDevice.pluginId);
            }

            if (pluginDevice.state[ScryptedInterfaceProperty.nativeId]?.value !== pluginDevice.nativeId) {
                dirty = true;
                setState(pluginDevice, ScryptedInterfaceProperty.nativeId, pluginDevice.nativeId);
            }

            if (dirty) {
                this.datastore.upsert(pluginDevice)
                    .catch(e => {
                        console.error('There was an error saving the device? Ignoring...', e);
                        // return this.datastore.remove(pluginDevice);
                    });
            }
        }

        for (const id of Object.keys(this.stateManager.getSystemState())) {
            if (hasMixinCycle(this, id)) {
                console.warn(`initialize: ${id} has a mixin cycle. Clearing mixins.`);
                const pluginDevice = this.findPluginDeviceById(id);
                setState(pluginDevice, ScryptedInterfaceProperty.mixins, []);
            }
        }

        const plugins: Plugin[] = [];
        for await (const plugin of this.datastore.getAll(Plugin)) {
            plugins.push(plugin);
        }

        for (const plugin of plugins) {
            try {
                const pluginDevice = this.findPluginDevice(plugin._id);
                setState(pluginDevice, ScryptedInterfaceProperty.info, {
                    manufacturer: plugin.packageJson.name,
                    version: plugin.packageJson.version,
                } as DeviceInformation);
                this.loadPlugin(plugin);
            }
            catch (e) {
                console.error('error loading plugin', plugin._id, e);
            }
        }

        for (const plugin of plugins) {
            try {
                this.probePluginDevices(plugin);
            }
            catch (e) {
                console.error('error probing plugin devices', plugin._id, e);
            }
        }

        if (process.env.SCRYPTED_INSTALL_PLUGIN && !plugins.find(plugin => plugin._id === process.env.SCRYPTED_INSTALL_PLUGIN)) {
            try {
                await this.installNpm(process.env.SCRYPTED_INSTALL_PLUGIN);
            }
            catch (e) {
                console.error('failed to auto install plugin', process.env.SCRYPTED_INSTALL_PLUGIN);
            }
        }
    }
}
