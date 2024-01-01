import { tsCompile } from '@scrypted/common/src/eval/scrypted-eval';
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
import { newScript, ScriptCore, ScriptCoreNativeId } from './script-core';
import { TerminalService, TerminalServiceNativeId } from './terminal-service';
import { UsersCore, UsersNativeId } from './user';

const { systemManager, deviceManager, endpointManager } = sdk;

export function getAddresses() {
    const addresses: string[] = [];
    for (const [iface, nif] of Object.entries(os.networkInterfaces())) {
        if (iface.startsWith('en') || iface.startsWith('eth') || iface.startsWith('wlan')) {
            addresses.push(iface);
            addresses.push(...nif.map(addr => addr.address));
        }
    }
    return addresses;
}

interface RoutedHttpRequest extends HttpRequest {
    params: { [key: string]: string };
}

class ScryptedCore extends ScryptedDeviceBase implements HttpRequestHandler, EngineIOHandler, DeviceProvider, Settings {
    router: any = Router();
    publicRouter: any = Router();
    mediaCore: MediaCore;
    scriptCore: ScriptCore;
    aggregateCore: AggregateCore;
    automationCore: AutomationCore;
    users: UsersCore;
    terminalService: TerminalService;
    localAddresses: string[];
    storageSettings = new StorageSettings(this, {
        localAddresses: {
            title: 'Scrypted Server Addresses',
            description: 'The IP addresses used by the Scrypted server. Set this to the wired IP address to prevent usage of a wireless address.',
            combobox: true,
            multiple: true,
            async onGet() {
                return {
                    choices: getAddresses(),
                };
            },
            mapGet: () => this.localAddresses,
            onPut: async (oldValue, newValue) => {
                this.localAddresses = newValue?.length ? newValue : undefined;
                const service = await sdk.systemManager.getComponent('addresses');
                service.setLocalAddresses(this.localAddresses);
            },
        }
    });
    indexHtml: string;

    constructor() {
        super();


        this.indexHtml = fs.readFileSync('dist/index.html').toString();

        (async () => {
            await deviceManager.onDeviceDiscovered(
                {
                    name: 'Media Core',
                    nativeId: 'mediacore',
                    interfaces: [ScryptedInterface.DeviceProvider, ScryptedInterface.BufferConverter, ScryptedInterface.HttpRequestHandler],
                    type: ScryptedDeviceType.Builtin,
                },
            );
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
        })();
        (async () => {
            await deviceManager.onDeviceDiscovered(
                {
                    name: 'Terminal Service',
                    nativeId: TerminalServiceNativeId,
                    interfaces: [ScryptedInterface.StreamService],
                    type: ScryptedDeviceType.Builtin,
                },
            );
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
        })();

        deviceManager.onDeviceDiscovered({
            name: 'Add to Launcher',
            nativeId: 'launcher',
            interfaces: [
                '@scrypted/launcher-ignore',
                ScryptedInterface.MixinProvider,
                ScryptedInterface.Readme,
            ],
            type: ScryptedDeviceType.Builtin,
        });

        (async () => {
            await deviceManager.onDeviceDiscovered(
                {
                    name: 'Device Groups',
                    nativeId: AggregateCoreNativeId,
                    interfaces: [ScryptedInterface.DeviceProvider, ScryptedInterface.DeviceCreator, ScryptedInterface.Readme],
                    type: ScryptedDeviceType.Builtin,
                },
            );
        })();


        (async () => {
            await deviceManager.onDeviceDiscovered(
                {
                    name: 'Scrypted Users',
                    nativeId: UsersNativeId,
                    interfaces: [ScryptedInterface.DeviceProvider, ScryptedInterface.DeviceCreator, ScryptedInterface.Readme],
                    type: ScryptedDeviceType.Builtin,
                },
            );
        })();
    }

    async getSettings(): Promise<Setting[]> {
        try {
            const service = await sdk.systemManager.getComponent('addresses');
            this.localAddresses = await service.getLocalAddresses(true);
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
            return this.mediaCore ||= new MediaCore();
        if (nativeId === ScriptCoreNativeId)
            return this.scriptCore ||= new ScriptCore();
        if (nativeId === AutomationCoreNativeId)
            return this.automationCore ||= new AutomationCore()
        if (nativeId === AggregateCoreNativeId)
            return this.aggregateCore ||= new AggregateCore();
        if (nativeId === UsersNativeId)
            return this.users ||= new UsersCore();
        if (nativeId === TerminalServiceNativeId)
            return this.terminalService ||= new TerminalService();
    }

    async releaseDevice(id: string, nativeId: string): Promise<void> {
    }

    checkEngineIoEndpoint(request: HttpRequest, name: string) {
        const check = `/endpoint/@scrypted/core/engine.io/${name}/`;
        if (!request.url.startsWith(check))
            return null;
        return check;
    }

    async checkService(request: HttpRequest, ws: WebSocket, name: string): Promise<boolean> {
        // only allow admin users to access these services.
        if (request.aclId)
            return false;
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

    async onConnection(request: HttpRequest, ws: WebSocket): Promise<void> {
        if (await this.checkService(request, ws, 'console') || await this.checkService(request, ws, 'repl')) {
            return;
        }

        ws.close();
    }

    async handlePublicFinal(request: HttpRequest, response: HttpResponse) {
        // need to strip off the query.
        const incomingPathname = request.url.split('?')[0];
        if (request.url !== '/index.html') {
            response.sendFile("dist" + incomingPathname);
            return;
        }

        // the rel hrefs (manifest, icons) are pulled in a web worker which does not
        // have cookies. need to attach auth info to them.
        try {
            const endpoint = await endpointManager.getPublicCloudEndpoint();
            const u = new URL(endpoint);

            const rewritten = this.indexHtml
                .replace('href="manifest.json"', `href="manifest.json${u.search}"`)
                .replace('href="img/icons/apple-touch-icon-152x152.png"', `href="img/icons/apple-touch-icon-152x152.png${u.search}"`)
                .replace('href="img/icons/safari-pinned-tab.svg"', `href="img/icons/safari-pinned-tab.svg${u.search}"`)
                ;
            response.send(rewritten, {
                headers: {
                    'Content-Type': 'text/html',
                }
            });
        }
        catch (e) {
            response.sendFile("dist" + incomingPathname);
        }
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
            await new Promise(resolve => this.publicRouter(normalizedRequest, response, resolve));
            await this.handlePublicFinal(normalizedRequest, response);
        }
        else {
            await new Promise(resolve => this.router(normalizedRequest, response, resolve));
            response.send('Not Found', {
                code: 404,
            });
        }
    }
}

export default ScryptedCore;

export async function fork() {
    return {
        tsCompile,
        newScript,
    }
}
