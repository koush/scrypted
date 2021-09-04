// https://developer.scrypted.app/#getting-started
// package.json contains the metadata (name, interfaces) about this device
// under the "scrypted" key.
import { ScryptedDeviceBase, HttpRequestHandler, HttpRequest, HttpResponse, EngineIOHandler, EventDetails, ScryptedDevice, EventListenerRegister, Device, DeviceManifest, EventListenerOptions, ScryptedInterfaceProperty, DeviceProvider, ScryptedInterface, MediaManager, ScryptedDeviceType } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
const { systemManager, deviceManager, mediaManager, endpointManager } = sdk;
import Router from 'router';
import Url from 'url-parse';
import { UserStorage } from './userStorage';
import { RpcPeer } from '../../../server/src/rpc';
import { setupPluginRemote } from '../../../server/src/plugin/plugin-remote';
import { PluginAPI } from '../../../server/src/plugin/plugin-api';
import { Logger } from '../../../server/src/logger';
import { UrlConverter } from './converters';
import fs from 'fs';
import { sendJSON } from './http-helpers';
import { Automation } from './automation';
import { AggregateDevice, createAggregateDevice } from './aggregate';
import net from 'net';

const indexHtml = fs.readFileSync('dist/index.html').toString();

interface RoutedHttpRequest extends HttpRequest {
    params: { [key: string]: string };
}

class DeviceLogger {
    logger: any;
    constructor(logger: any) {
        this.logger = logger;
    }

    log(level: string, msg: string) {
        this.logger?.[level]?.(msg);
    };
}

async function reportAutomation(nativeId: string) {
    const device: Device = {
        nativeId,
        type: ScryptedDeviceType.Automation,
        interfaces: [ScryptedInterface.OnOff]
    }
    await deviceManager.onDeviceDiscovered(device);
}

async function reportAggregate(nativeId: string, interfaces: string[]) {
    const device: Device = {
        nativeId,
        type: ScryptedDeviceType.Unknown,
        interfaces,
    }
    await deviceManager.onDeviceDiscovered(device);
}

class ScryptedCore extends ScryptedDeviceBase implements HttpRequestHandler, EngineIOHandler, DeviceProvider {
    router = Router();
    publicRouter = Router();
    httpHost: UrlConverter;
    httpsHost: UrlConverter;
    automations = new Map<string, Automation>();
    aggregate = new Map<string, AggregateDevice>();

    constructor() {
        super();

        (async () => {
            await deviceManager.onDeviceDiscovered(
                {
                    name: 'HTTP file host',
                    nativeId: 'http',
                    interfaces: [ScryptedInterface.BufferConverter, ScryptedInterface.HttpRequestHandler],
                },
            );
            await deviceManager.onDeviceDiscovered(
                {
                    name: 'HTTPS file host',
                    nativeId: 'https',
                    interfaces: [ScryptedInterface.BufferConverter, ScryptedInterface.HttpRequestHandler],
                }
            );
            this.httpHost = new UrlConverter(false);
            this.httpsHost = new UrlConverter(true);
        })();

        for (const nativeId of deviceManager.getNativeIds()) {
            if (nativeId?.startsWith('automation:')) {
                const automation = new Automation(nativeId);
                this.automations.set(nativeId, automation);
                reportAutomation(nativeId);
            }
            else if (nativeId?.startsWith('aggregate:')) {
                const aggregate = createAggregateDevice(nativeId);
                this.aggregate.set(nativeId, aggregate);
                reportAggregate(nativeId, aggregate.computeInterfaces());
            }
        }

        this.router.post('/api/new/automation', async (req: RoutedHttpRequest, res: HttpResponse) => {
            const nativeId = `automation:${Math.random()}`;
            await reportAutomation(nativeId);
            const automation = new Automation(nativeId);
            this.automations.set(nativeId, automation);
            const { id } = automation;
            sendJSON(res, {
                id,
            });
        });

        this.router.post('/api/new/aggregate', async (req: RoutedHttpRequest, res: HttpResponse) => {
            const nativeId = `aggregate:${Math.random()}`;
            await reportAggregate(nativeId, []);
            const aggregate = createAggregateDevice(nativeId);
            this.aggregate.set(nativeId, aggregate);
            const { id } = aggregate;
            sendJSON(res, {
                id,
            });
        });
    }

    getDevice(nativeId: string) {
        if (nativeId === 'http')
            return this.httpHost;
        if (nativeId === 'https')
            return this.httpsHost;
        if (nativeId?.startsWith('automation:'))
            return this.automations.get(nativeId);
        if (nativeId?.startsWith('aggregate:'))
            return createAggregateDevice(nativeId);
    }

    async discoverDevices(duration: number) {
    }

    async checkService(request: HttpRequest, ws: WebSocket, name: string): Promise<boolean> {
        const check = `/endpoint/@scrypted/core/engine.io/${name}/`;
        if (!request.url.startsWith(check))
            return false;
        const deviceId = request.url.substr(check.length).split('/')[0];
        const plugins = await systemManager.getComponent('plugins');
        const { nativeId, pluginId } = await plugins.getDeviceInfo(deviceId);
        const port = await plugins.getRemoteServicePort(pluginId, name);
        const socket = net.connect(port);
        socket.on('data', data => ws.send(data));
        socket.resume();
        socket.write(nativeId?.toString() || 'undefined');
        ws.onclose = () => socket.destroy();
        ws.onmessage = message => socket.write(message.data);
        return true;
    }

    async onConnection(request: HttpRequest, webSocketUrl: string): Promise<void> {
        const ws = new WebSocket(webSocketUrl);

        if (await this.checkService(request, ws, 'console') || await this.checkService(request, ws, 'repl')) {
            return;
        }

        if (request.isPublicEndpoint) {
            ws.close();
            return;
        }

        const peer = new RpcPeer(message => ws.send(JSON.stringify(message)));
        ws.onmessage = message => peer.handleMessage(JSON.parse(message.data));
        const userStorage = new UserStorage(request.username);
        peer.params.userStorage = userStorage;

        class PluginAPIImpl implements PluginAPI {
            async getMediaManager(): Promise<MediaManager> {
                return mediaManager;
            }
            async getLogger(nativeId: string): Promise<Logger> {
                const dl = deviceManager.getDeviceLogger(nativeId);
                const ret = new DeviceLogger(dl);
                return ret as any;
            }
            getComponent(id: string): Promise<any> {
                return systemManager.getComponent(id);
            }
            async setDeviceProperty(id: string, property: ScryptedInterfaceProperty, value: any): Promise<void> {
                const device = await this.getDeviceById(id);
                if (property === ScryptedInterfaceProperty.name)
                    device.setName(value);
                else if (property === ScryptedInterfaceProperty.type)
                    device.setType(value);
                else if (property === ScryptedInterfaceProperty.room)
                    device.setRoom(value);
                else
                    throw new Error(`Not allowed to set property ${property}`);
            }
            async setState(nativeId: string, key: string, value: any) {
                deviceManager.getDeviceState(nativeId)[key] = value;
            }
            async onDevicesChanged(deviceManifest: DeviceManifest) {
                return deviceManager.onDevicesChanged(deviceManifest);
            }
            async onDeviceDiscovered(device: Device) {
                return deviceManager.onDeviceDiscovered(device);
            }
            async onDeviceEvent(nativeId: string, eventInterface: any, eventData?: any) {
                return deviceManager.onDeviceEvent(nativeId, eventInterface, eventData);
            }
            async onDeviceRemoved(nativeId: string) {
                return deviceManager.onDeviceRemoved(nativeId);
            }
            async setStorage(nativeId: string, storage: { [key: string]: any; }) {
                const ds = deviceManager.getDeviceStorage(nativeId);
                ds.clear();
                for (const key of Object.keys(storage)) {
                    ds.setItem(key, storage[key]);
                }
            }
            async getDeviceById(id: string): Promise<ScryptedDevice> {
                return systemManager.getDeviceById(id);
            }
            async listen(EventListener: (id: string, eventDetails: EventDetails, eventData: any) => void): Promise<EventListenerRegister> {
                return systemManager.listen((eventSource, eventDetails, eventData) => EventListener(eventSource?.id, eventDetails, eventData));
            }
            async listenDevice(id: string, event: string | EventListenerOptions, callback: (eventDetails: EventDetails, eventData: object) => void): Promise<EventListenerRegister> {
                return systemManager.listenDevice(id, event, (eventSource, eventDetails, eventData) => callback(eventDetails, eventData));
            }
            async ioClose(id: string) {
                throw new Error('Method not implemented.');
            }
            async ioSend(id: string, message: string) {
                throw new Error('Method not implemented.');
            }
            async removeDevice(id: string) {
                return systemManager.removeDevice(id);
            }
            async kill() {
            }
        }
        const api = new PluginAPIImpl();

        const remote = await setupPluginRemote(peer, api, null);
        await remote.setSystemState(systemManager.getSystemState());

        // this listener keeps the system state up to date on the other end.
        // use the api listen instead of system manager because the listeners are detached
        // on connection close.
        api.listen((id, eventDetails, eventData) => {
            const eventSource = systemManager.getDeviceById(id);
            if (eventDetails.eventInterface === ScryptedInterface.ScryptedDevice) {
                if (eventDetails.property === ScryptedInterfaceProperty.id) {
                    remote.updateDescriptor(eventData, undefined);
                }
                else if (!eventSource) {
                    console.warn('unknown event source', eventData);
                }
                else {
                    remote.updateDescriptor(eventSource.id, systemManager.getDeviceState(eventSource.id));
                }
                return;
            }

            if (eventDetails.eventInterface === 'Storage') {
                let ids = [...this.automations.values()].map(a => a.id);
                if (ids.includes(eventSource.id)) {
                    const automation = [...this.automations.values()].find(a => a.id === eventSource.id);
                    automation.bind();
                }
                ids = [...this.aggregate.values()].map(a => a.id);
                if (ids.includes(eventSource.id)) {
                    const aggregate = [...this.aggregate.values()].find(a => a.id === eventSource.id);
                    reportAggregate(aggregate.nativeId, aggregate.computeInterfaces());
                }
            }

            if (eventDetails.property) {
                if (!eventSource) {
                    console.warn('unknown event source', eventData);
                }
                else {
                    const propertyState = systemManager.getDeviceState(eventSource.id)?.[eventDetails.property];
                    remote.notify(eventSource.id, eventDetails.eventTime, eventDetails.eventInterface, eventDetails.property, propertyState, eventDetails.changed);
                }
            }
            else {
                remote.notify(undefined, eventDetails.eventTime, eventDetails.eventInterface, eventDetails.property, eventData, eventDetails.changed);
            }
        })

        ws.onclose = () => {
            api.kill();
        }
    }

    handlePublicFinal(request: HttpRequest, response: HttpResponse) {
        // need to strip off the query.
        const incomingUrl = new Url(request.url);
        if (request.url !== '/index.html') {
            response.sendFile("dist" + incomingUrl.pathname);
            return;
        }

        // the rel hrefs (manifest, icons) are pulled in a web worker which does not
        // have cookies. need to attach auth info to them.
        endpointManager.getPublicCloudEndpoint()
            .then(endpoint => {
                const u = new Url(endpoint);
                const rewritten = indexHtml
                    .replace('href=/endpoint/@scrypted/core/public/manifest.json', `href="/endpoint/@scrypted/core/public/manifest.json${u.query}"`)
                    .replace('href=/endpoint/@scrypted/core/public/img/icons/apple-touch-icon-152x152.png', `href="/endpoint/@scrypted/core/public/img/icons/apple-touch-icon-152x152.png${u.query}"`)
                    .replace('href=/endpoint/@scrypted/core/public/img/icons/safari-pinned-tab.svg', `href="/endpoint/@scrypted/core/public/img/icons/safari-pinned-tab.svg${u.query}"`)
                    ;
                response.send(rewritten, {
                    headers: {
                        'Content-Type': 'text/html',
                    }
                });
            })
            .catch(() => {
                response.sendFile("dist" + incomingUrl.pathname);
            });
    }

    async onRequest(request: HttpRequest, response: HttpResponse) {
        const normalizedRequest: RoutedHttpRequest = Object.assign({
            params: {},
        }, request);
        normalizedRequest.url = normalizedRequest.url.replace(normalizedRequest.rootPath, '');
        if (normalizedRequest.url == '/' || normalizedRequest.url == '/?') {
            normalizedRequest.url = '/index.html';
        }

        if (request.isPublicEndpoint) {
            this.publicRouter(normalizedRequest, response, () => this.handlePublicFinal(normalizedRequest, response));
        }
        else {
            this.router(normalizedRequest, response, () => {
                response.send('Not Found', {
                    code: 404,
                });
            });
        }
    }
}

export default new ScryptedCore();
