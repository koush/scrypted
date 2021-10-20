// https://developer.scrypted.app/#getting-started
// package.json contains the metadata (name, interfaces) about this device
// under the "scrypted" key.
import { ScryptedDeviceBase, HttpRequestHandler, HttpRequest, HttpResponse, EngineIOHandler, Device, ScryptedInterfaceProperty, DeviceProvider, ScryptedInterface, ScryptedDeviceType } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
const { systemManager, deviceManager, mediaManager, endpointManager } = sdk;
import Router from 'router';
import Url from 'url-parse';
import { UserStorage } from './userStorage';
import { RpcPeer } from '../../../server/src/rpc';
import { setupPluginRemote } from '../../../server/src/plugin/plugin-remote';
import { PluginAPIProxy } from '../../../server/src/plugin/plugin-api';
import { UrlConverter } from './converters';
import fs from 'fs';
import { sendJSON } from './http-helpers';
import { Automation } from './automation';
import { AggregateDevice, createAggregateDevice } from './aggregate';
import net from 'net';
import { Script } from './script';
import { addBuiltins } from "../../../common/src/wrtc-converters";
import { updatePluginsData } from './update-plugins';

addBuiltins(console, mediaManager);

const { pluginHostAPI } = sdk;

const indexHtml = fs.readFileSync('dist/index.html').toString();

interface RoutedHttpRequest extends HttpRequest {
    params: { [key: string]: string };
}

async function reportAutomation(nativeId: string, name?: string) {
    const device: Device = {
        name,
        nativeId,
        type: ScryptedDeviceType.Automation,
        interfaces: [ScryptedInterface.OnOff]
    }
    await deviceManager.onDeviceDiscovered(device);
}

async function reportScript(nativeId: string) {
    const device: Device = {
        name: undefined,
        nativeId,
        type: ScryptedDeviceType.Program,
        interfaces: [ScryptedInterface.Scriptable, ScryptedInterface.Program]
    }
    await deviceManager.onDeviceDiscovered(device);
}

async function reportAggregate(nativeId: string, interfaces: string[]) {
    const device: Device = {
        name: undefined,
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
    scripts = new Map<string, Script>();

    constructor() {
        super();

        (async () => {
            await deviceManager.onDeviceDiscovered(
                {
                    name: 'HTTP file host',
                    nativeId: 'http',
                    interfaces: [ScryptedInterface.BufferConverter, ScryptedInterface.HttpRequestHandler],
                    type: ScryptedDeviceType.API,
                },
            );
            await deviceManager.onDeviceDiscovered(
                {
                    name: 'HTTPS file host',
                    nativeId: 'https',
                    interfaces: [ScryptedInterface.BufferConverter, ScryptedInterface.HttpRequestHandler],
                    type: ScryptedDeviceType.API,
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
            else if (nativeId?.startsWith('script:')) {
                const script = new Script(nativeId);
                this.scripts.set(nativeId, script);
                reportScript(nativeId);
            }
        }

        (async() => {
            const updatePluginsNativeId = 'automation:update-plugins'
            let updatePlugins = this.automations.get(updatePluginsNativeId);
            if (!updatePlugins) {
                await reportAutomation(updatePluginsNativeId, 'Autoupdate Plugins');
                updatePlugins = new Automation(updatePluginsNativeId);
                this.automations.set(updatePluginsNativeId, updatePlugins);
            }
            updatePlugins.storage.setItem('data', JSON.stringify(updatePluginsData));
        })();

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

        this.router.post('/api/new/script', async (req: RoutedHttpRequest, res: HttpResponse) => {
            const nativeId = `script:${Math.random()}`;
            await reportScript(nativeId);
            const script = new Script(nativeId);
            this.scripts.set(nativeId, script);
            const { id } = script;
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
            return this.aggregate.get(nativeId);
        if (nativeId?.startsWith('script:'))
            return this.scripts.get(nativeId);
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
        socket.on('close', () => ws.close());
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

        const api = new PluginAPIProxy(pluginHostAPI, mediaManager);
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
            peer.kill('engine.io connection closed.')
            api.removeListeners();
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
