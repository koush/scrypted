import sdk, { DeviceProvider, EngineIOHandler, HttpRequest, HttpRequestHandler, HttpResponse, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting, Settings, SettingValue } from '@scrypted/sdk';
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import fs from 'fs';
import net from 'net';
import os from 'os';
import Router from 'router';
import { AggregateCore, AggregateCoreNativeId } from './aggregate-core';
import { AutomationCore, AutomationCoreNativeId } from './automations-core';
import { LauncherMixin } from './launcher-mixin';
import { MediaCore } from './media-core';
import { ScriptCore, ScriptCoreNativeId } from './script-core';

const { systemManager, deviceManager, endpointManager } = sdk;

const indexHtml = fs.readFileSync('dist/index.html').toString();

export function getAddresses() {
    const addresses = Object.entries(os.networkInterfaces()).filter(([iface]) => iface.startsWith('en') || iface.startsWith('eth') || iface.startsWith('wlan')).map(([_, addr]) => addr).flat().map(info => info.address).filter(address => address);
    return addresses;
}

interface RoutedHttpRequest extends HttpRequest {
    params: { [key: string]: string };
}


class ScryptedCore extends ScryptedDeviceBase implements HttpRequestHandler, EngineIOHandler, DeviceProvider, Settings {
    router: any = Router();
    publicRouter: any = Router();
    mediaCore: MediaCore;
    launcher: LauncherMixin;
    scriptCore: ScriptCore;
    aggregateCore: AggregateCore;
    automationCore: AutomationCore;
    localAddresses: string[];
    storageSettings = new StorageSettings(this, {
        localAddresses: {
            title: 'Scrypted Server Address',
            description: 'The IP address used by the Scrypted server. Set this to the wired IP address to prevent usage of a wireless address.',
            combobox: true,
            async onGet() {
                return {
                    choices: getAddresses(),
                };
            },
            mapGet: () => this.localAddresses?.[0],
            onPut: async (oldValue, newValue) => {
                this.localAddresses = newValue ? [newValue] : undefined;
                const service = await sdk.systemManager.getComponent('addresses');
                service.setLocalAddresses(this.localAddresses);
            },
        }
    });

    constructor() {
        super();

        (async () => {
            await deviceManager.onDeviceDiscovered(
                {
                    name: 'Media Core',
                    nativeId: 'mediacore',
                    interfaces: [ScryptedInterface.DeviceProvider, ScryptedInterface.BufferConverter, ScryptedInterface.HttpRequestHandler],
                    type: ScryptedDeviceType.Builtin,
                },
            );
            this.mediaCore = new MediaCore('mediacore');
        })();
        (async () => {
            await deviceManager.onDeviceDiscovered(
                {
                    name: 'Scripts',
                    nativeId: ScriptCoreNativeId,
                    interfaces: [ScryptedInterface.DeviceProvider, ScryptedInterface.DeviceCreator, ScryptedInterface.Readme],
                    type: ScryptedDeviceType.Builtin,
                },
            );
            this.scriptCore = new ScriptCore();
        })();

        (async () => {
            await deviceManager.onDeviceDiscovered(
                {
                    name: 'Automations',
                    nativeId: AutomationCoreNativeId,
                    interfaces: [ScryptedInterface.DeviceProvider, ScryptedInterface.DeviceCreator, ScryptedInterface.Readme],
                    type: ScryptedDeviceType.Builtin,
                },
            );
            this.automationCore = new AutomationCore();
        })();

        (async () => {
            await deviceManager.onDeviceDiscovered(
                {
                    name: 'Device Groups',
                    nativeId: AggregateCoreNativeId,
                    interfaces: [ScryptedInterface.DeviceProvider, ScryptedInterface.DeviceCreator, ScryptedInterface.Readme],
                    type: ScryptedDeviceType.Builtin,
                },
            );
            this.aggregateCore = new AggregateCore();
        })();
    }

    async getSettings(): Promise<Setting[]> {
        try {
            const service = await sdk.systemManager.getComponent('addresses');
            this.localAddresses = await service.getLocalAddresses();
        }
        catch (e) {
        }
        return this.storageSettings.getSettings();
    }
    async putSetting(key: string, value: SettingValue): Promise<void> {
        await this.storageSettings.putSetting(key, value);
    }

    async getDevice(nativeId: string) {
        if (nativeId === 'launcher')
            return new LauncherMixin('launcher');
        if (nativeId === 'mediacore')
            return this.mediaCore;
        if (nativeId === ScriptCoreNativeId)
            return this.scriptCore;
        if (nativeId === AutomationCoreNativeId)
            return this.automationCore;
        if (nativeId === AggregateCoreNativeId)
            return this.aggregateCore;
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

        ws.close();
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

export default ScryptedCore;
