import { readFileAsString, tsCompile } from '@scrypted/common/src/eval/scrypted-eval';
import sdk, { DeviceProvider, HttpRequest, HttpRequestHandler, HttpResponse, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting, SettingValue, Settings } from '@scrypted/sdk';
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import { writeFileSync } from 'fs';
import path from 'path';
import Router from 'router';
import yaml from 'yaml';
import { getUsableNetworkAddresses } from '../../../server/src/ip';
import { AggregateCore, AggregateCoreNativeId } from './aggregate-core';
import { AutomationCore, AutomationCoreNativeId } from './automations-core';
import { LauncherMixin } from './launcher-mixin';
import { MediaCore } from './media-core';
import { checkLegacyLxc, checkLxc } from './platform/lxc';
import { ConsoleServiceNativeId, PluginSocketService, ReplServiceNativeId } from './plugin-socket-service';
import { ScriptCore, ScriptCoreNativeId, newScript } from './script-core';
import { TerminalService, TerminalServiceNativeId, newTerminalService } from './terminal-service';
import { UsersCore, UsersNativeId } from './user';
import { ClusterCore, ClusterCoreNativeId } from './cluster';

const { deviceManager, endpointManager } = sdk;

interface RoutedHttpRequest extends HttpRequest {
    params: { [key: string]: string };
}

class ScryptedCore extends ScryptedDeviceBase implements HttpRequestHandler, DeviceProvider, Settings {
    router: any = Router();
    publicRouter: any = Router();
    mediaCore: MediaCore;
    scriptCore: ScriptCore;
    clusterCore: ClusterCore;
    aggregateCore: AggregateCore;
    automationCore: AutomationCore;
    users: UsersCore;
    consoleService: PluginSocketService;
    replService: PluginSocketService;
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
                    choices: getUsableNetworkAddresses(),
                };
            },
            mapGet: () => this.localAddresses,
            onPut: async (oldValue, newValue) => {
                this.localAddresses = newValue?.length ? newValue : undefined;
                const service = await sdk.systemManager.getComponent('addresses');
                service.setLocalAddresses(this.localAddresses);
            },
        },
        releaseChannel: {
            group: 'Advanced',
            title: 'Server Release Channel',
            description: 'The release channel to use for server updates. A specific version or tag can be manually entered as well. Changing this setting will update the image field in /root/.scrypted/docker-compose.yml. Invalid values may prevent the server from properly starting.',
            defaultValue: 'Default',
            choices: [
                'Default',
                'latest',
                'beta',
                `v${sdk.serverVersion}-jammy-full`,
            ],
            combobox: true,
            onPut: (ov, nv) => {
                this.updateReleaseChannel(nv);
            },
            mapGet: () => {
                try {
                    const dockerCompose = yaml.parseDocument(readFileAsString('/root/.scrypted/docker-compose.yml'));
                    // @ts-ignore
                    const image: string = dockerCompose.contents.get('services').get('scrypted').get('image');
                    const label = image.split(':')[1] || undefined;
                    return label || 'Default';
                }
                catch (e) {
                    return 'Default';
                }
            }
        },
        pullImage: {
            hide: true,
            onPut: () => {
                this.setPullImage();
            }
        },
    });
    indexHtml: string;

    constructor() {
        super();

        this.systemDevice = {
            settings: "General",
        }

        checkLegacyLxc();
        checkLxc();

        this.storageSettings.settings.releaseChannel.hide = process.env.SCRYPTED_INSTALL_ENVIRONMENT !== 'lxc-docker';

        this.indexHtml = readFileAsString('dist/index.html');

        (async () => {
            await deviceManager.onDeviceDiscovered(
                {
                    name: 'Cluster Manager',
                    nativeId: ClusterCoreNativeId,
                    interfaces: [ScryptedInterface.Settings, ScryptedInterface.Readme, ScryptedInterface.ScryptedSettings],
                    type: ScryptedDeviceType.Builtin,
                },
            );
        })();
        (async () => {
            await deviceManager.onDeviceDiscovered(
                {
                    name: 'Media Core',
                    nativeId: 'mediacore',
                    interfaces: [ScryptedInterface.DeviceProvider, ScryptedInterface.BufferConverter, ScryptedInterface.HttpRequestHandler],
                    type: ScryptedDeviceType.Internal,
                },
            );
        })();
        (async () => {
            await deviceManager.onDeviceDiscovered(
                {
                    name: 'Scripts',
                    nativeId: ScriptCoreNativeId,
                    interfaces: [ScryptedInterface.ScryptedSystemDevice, ScryptedInterface.ScryptedDeviceCreator, ScryptedInterface.DeviceProvider, ScryptedInterface.DeviceCreator, ScryptedInterface.Readme],
                    type: ScryptedDeviceType.Internal,
                },
            );
        })();
        (async () => {
            await deviceManager.onDeviceDiscovered(
                {
                    name: 'Terminal Service',
                    nativeId: TerminalServiceNativeId,
                    interfaces: [ScryptedInterface.StreamService, ScryptedInterface.TTY, ScryptedInterface.ClusterForkInterface],
                    type: ScryptedDeviceType.Internal,
                },
            );
        })();
        (async () => {
            await deviceManager.onDeviceDiscovered(
                {
                    name: 'REPL Service',
                    nativeId: ReplServiceNativeId,
                    interfaces: [ScryptedInterface.StreamService],
                    type: ScryptedDeviceType.Internal,
                },
            );
        })();
        (async () => {
            await deviceManager.onDeviceDiscovered(
                {
                    name: 'Console Service',
                    nativeId: ConsoleServiceNativeId,
                    interfaces: [ScryptedInterface.StreamService],
                    type: ScryptedDeviceType.Internal,
                },
            );
        })();

        (async () => {
            await deviceManager.onDeviceDiscovered(
                {
                    name: 'Automations',
                    nativeId: AutomationCoreNativeId,
                    interfaces: [ScryptedInterface.ScryptedSystemDevice, ScryptedInterface.ScryptedDeviceCreator, ScryptedInterface.DeviceProvider, ScryptedInterface.DeviceCreator, ScryptedInterface.Readme],
                    type: ScryptedDeviceType.Internal,
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
            type: ScryptedDeviceType.Internal,
        });

        (async () => {
            await deviceManager.onDeviceDiscovered(
                {
                    name: 'Device Groups',
                    nativeId: AggregateCoreNativeId,
                    interfaces: [ScryptedInterface.ScryptedSystemDevice, ScryptedInterface.ScryptedDeviceCreator, ScryptedInterface.DeviceProvider, ScryptedInterface.DeviceCreator, ScryptedInterface.Readme],
                    type: ScryptedDeviceType.Builtin,
                },
            );
        })();


        (async () => {
            await deviceManager.onDeviceDiscovered(
                {
                    name: 'Scrypted Users',
                    nativeId: UsersNativeId,
                    interfaces: [ScryptedInterface.ScryptedSystemDevice, ScryptedInterface.ScryptedDeviceCreator, ScryptedInterface.DeviceProvider, ScryptedInterface.DeviceCreator, ScryptedInterface.Readme],
                    type: ScryptedDeviceType.Internal,
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
        if (nativeId === ClusterCoreNativeId)
            return this.clusterCore ||= new ClusterCore(ClusterCoreNativeId);
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
            return this.terminalService ||= new TerminalService(TerminalServiceNativeId, false);
        if (nativeId === ReplServiceNativeId)
            return this.replService ||= new PluginSocketService(ReplServiceNativeId, 'repl');
        if (nativeId === ConsoleServiceNativeId)
            return this.consoleService ||= new PluginSocketService(ConsoleServiceNativeId, 'console');
    }

    async releaseDevice(id: string, nativeId: string): Promise<void> {
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

    setPullImage() {
        writeFileSync(path.join(process.env.SCRYPTED_VOLUME, '.pull'), '');
    }

    async updateReleaseChannel(releaseChannel: string) {
        if (!releaseChannel || releaseChannel === 'Default')
            releaseChannel = '';
        else
            releaseChannel = `:${releaseChannel}`;
        const dockerCompose = yaml.parseDocument(readFileAsString('/root/.scrypted/docker-compose.yml'));
        // @ts-ignore
        dockerCompose.contents.get('services').get('scrypted').set('image', `ghcr.io/koush/scrypted${releaseChannel}`);
        yaml.stringify(dockerCompose);
        writeFileSync('/root/.scrypted/docker-compose.yml', yaml.stringify(dockerCompose));
        this.setPullImage();

        const serviceControl = await sdk.systemManager.getComponent("service-control");
        await serviceControl.exit().catch(() => { });
        await serviceControl.restart();
    }
}

export default ScryptedCore;

export async function fork() {
    return {
        tsCompile,
        newScript,
        newTerminalService,
    }
}
