import { ScryptedDeviceBase, HttpRequestHandler, HttpRequest, HttpResponse, EngineIOHandler, Device, DeviceProvider, ScryptedInterface, ScryptedDeviceType, RTCSignalingChannel, VideoCamera } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
const { systemManager, deviceManager, mediaManager, endpointManager } = sdk;
import Router from 'router';
import { UserStorage } from './userStorage';
import { RpcPeer } from '../../../server/src/rpc';
import { setupPluginRemote } from '../../../server/src/plugin/plugin-remote';
import { PluginAPIProxy } from '../../../server/src/plugin/plugin-api';
import fs from 'fs';
import { sendJSON } from './http-helpers';
import { Automation } from './automation';
import { AggregateDevice, createAggregateDevice } from './aggregate';
import net from 'net';
import { addBuiltins } from "@scrypted/common/src/ffmpeg-to-wrtc";
import { updatePluginsData } from './update-plugins';
import { MediaCore } from './media-core';
import { startBrowserRTCSignaling } from "@scrypted/common/src/ffmpeg-to-wrtc";
import { ScriptCore, ScriptCoreNativeId } from './script-core';

addBuiltins(mediaManager);

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
        interfaces: [ScryptedInterface.OnOff, ScryptedInterface.Settings]
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
    router: any = Router();
    publicRouter: any = Router();
    mediaCore: MediaCore;
    scriptCore: ScriptCore;
    automations = new Map<string, Automation>();
    aggregate = new Map<string, AggregateDevice>();

    constructor() {
        super();

        (async () => {
            await deviceManager.onDeviceDiscovered(
                {
                    name: 'Media Core',
                    nativeId: 'mediacore',
                    interfaces: [ScryptedInterface.DeviceProvider, ScryptedInterface.BufferConverter],
                    type: ScryptedDeviceType.API,
                },
            );
            this.mediaCore = new MediaCore('mediacore');
        })();
        (async () => {
            await deviceManager.onDeviceDiscovered(
                {
                    name: 'Scripting Core',
                    nativeId: ScriptCoreNativeId,
                    interfaces: [ScryptedInterface.DeviceProvider, ScryptedInterface.DeviceCreator, ScryptedInterface.Readme],
                    type: ScryptedDeviceType.API,
                },
            );
            this.scriptCore = new ScriptCore(ScriptCoreNativeId);
        })();

        for (const nativeId of deviceManager.getNativeIds()) {
            if (nativeId?.startsWith('automation:')) {
                const automation = new Automation(nativeId);
                this.automations.set(nativeId, automation);
                reportAutomation(nativeId, automation.providedName);
            }
            else if (nativeId?.startsWith('aggregate:')) {
                const aggregate = createAggregateDevice(nativeId);
                this.aggregate.set(nativeId, aggregate);
                reportAggregate(nativeId, aggregate.computeInterfaces());
            }
        }

        (async () => {
            const updatePluginsNativeId = 'automation:update-plugins'
            let updatePlugins = this.automations.get(updatePluginsNativeId);
            if (!updatePlugins) {
                await reportAutomation(updatePluginsNativeId, 'Autoupdate Plugins');
                updatePlugins = new Automation(updatePluginsNativeId);
                updatePlugins.storage.setItem('data', JSON.stringify(updatePluginsData));
                this.automations.set(updatePluginsNativeId, updatePlugins);
            }
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

        // update the automations and grouped devices on storage change.
        systemManager.listen((eventSource, eventDetails, eventData) => {
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
        });
    }

    async getDevice(nativeId: string) {
        if (nativeId === 'mediacore')
            return this.mediaCore;
        if (nativeId === ScriptCoreNativeId)
            return this.scriptCore;
        if (nativeId?.startsWith('automation:'))
            return this.automations.get(nativeId);
        if (nativeId?.startsWith('aggregate:'))
            return this.aggregate.get(nativeId);
    }

    checkEngineIoEndpoint(request: HttpRequest, name: string) {
        const check = `/endpoint/@scrypted/core/engine.io/${name}/`;
        if (!request.url.startsWith(check))
            return null;
        return check;
    }

    async checkService(request: HttpRequest, ws: WebSocket, name: string): Promise<boolean> {
        const check = this.checkEngineIoEndpoint(request, name);
        if (!check)
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

        if (this.checkEngineIoEndpoint(request, 'videocamera')) {
            const url = new URL(`http://localhost${request.url}`);
            const deviceId = url.searchParams.get('deviceId');
            const camera = systemManager.getDeviceById<VideoCamera & RTCSignalingChannel>(deviceId);
            if (!camera)
                ws.close();
            else
                startBrowserRTCSignaling(camera, ws, this.console);
            return;
        }

        if (request.isPublicEndpoint) {
            ws.close();
            return;
        }

        const peer = new RpcPeer("core", "web", message => ws.send(JSON.stringify(message)));
        ws.onmessage = message => peer.handleMessage(JSON.parse(message.data));
        const userStorage = new UserStorage(request.username);
        peer.params.userStorage = userStorage;

        const api = new PluginAPIProxy(pluginHostAPI, mediaManager);

        ws.onclose = () => {
            peer.kill('engine.io connection closed.')
            api.removeListeners();
        }

        try {
            await setupPluginRemote(peer, api, null, () => systemManager.getSystemState());
        }
        catch (e) {
            ws.close();
        }
    }

    handlePublicFinal(request: HttpRequest, response: HttpResponse) {
        // need to strip off the query.
        const incomingPathname = request.url.split('?')[0];
        if (request.url !== '/index.html') {
            response.sendFile("dist" + incomingPathname);
            return;
        }

        // the rel hrefs (manifest, icons) are pulled in a web worker which does not
        // have cookies. need to attach auth info to them.
        endpointManager.getPublicCloudEndpoint()
            .then(endpoint => {
                const u = new URL(endpoint);

                const rewritten = indexHtml
                    .replace('href="/endpoint/@scrypted/core/public/manifest.json"', `href="/endpoint/@scrypted/core/public/manifest.json${u.search}"`)
                    .replace('href="/endpoint/@scrypted/core/public/img/icons/apple-touch-icon-152x152.png"', `href="/endpoint/@scrypted/core/public/img/icons/apple-touch-icon-152x152.png${u.search}"`)
                    .replace('href="/endpoint/@scrypted/core/public/img/icons/safari-pinned-tab.svg"', `href="/endpoint/@scrypted/core/public/img/icons/safari-pinned-tab.svg${u.search}"`)
                    ;
                response.send(rewritten, {
                    headers: {
                        'Content-Type': 'text/html',
                    }
                });
            })
            .catch(() => {
                response.sendFile("dist" + incomingPathname);
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
