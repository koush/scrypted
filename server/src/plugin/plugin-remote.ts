import { EventDetails, MediaManager, ScryptedInterface, ScryptedInterfaceProperty, ScryptedNativeId, ScryptedStatic, SystemDeviceState, SystemManager } from '@scrypted/types';
import { RpcPeer, RPCResultError } from '../rpc';
import { BufferSerializer } from '../rpc-buffer-serializer';
import { AccessControls } from './acl';
import { DeviceManagerImpl, StorageImpl } from './device';
import { EndpointManagerImpl } from './endpoint';
import { PluginAPI, PluginHostInfo, PluginRemote, PluginRemoteLoadZipOptions, PluginZipAPI } from './plugin-api';
import { createWebSocketClass, WebSocketConnectCallbacks, WebSocketConnection, WebSocketMethods, WebSocketSerializer } from './plugin-remote-websocket';
import { SystemManagerImpl } from './system';
import { ClusterManagerImpl } from './cluster';


export async function setupPluginRemote(peer: RpcPeer, api: PluginAPI, pluginId: string, hostInfo: PluginHostInfo, getSystemState: () => { [id: string]: { [property: string]: SystemDeviceState } }): Promise<PluginRemote> {
    try {
        // the host/remote connection can be from server to plugin (node to node),
        // core plugin to web (node to browser).
        // always add the BufferSerializer, so serialization is gauranteed to work.
        // but in plugin-host, mark Buffer as transport safe.
        if (!peer.constructorSerializerMap.get(Buffer))
            peer.addSerializer(Buffer, 'Buffer', new BufferSerializer());
        const getRemote = await peer.getParam('getRemote');
        const remote = await getRemote(api, pluginId, hostInfo) as PluginRemote;

        const accessControls: AccessControls = peer.tags.acl;

        const getAccessControlDeviceState = (id: string, state?: { [property: string]: SystemDeviceState }) => {
            state = state || getSystemState()[id];
            if (accessControls && state) {
                state = Object.assign({}, state);
                for (const property of Object.keys(state)) {
                    if (accessControls.shouldRejectProperty(id, property))
                        delete state[property];
                }
                let interfaces: ScryptedInterface[] = state.interfaces?.value;
                if (interfaces) {
                    interfaces = interfaces.filter(scryptedInterface => !accessControls.shouldRejectInterface(id, scryptedInterface));
                    state.interfaces = {
                        value: interfaces,
                    }
                }
            }
            return state;
        }

        const getAccessControlSystemState = () => {
            let state = getSystemState();
            if (accessControls) {
                state = Object.assign({}, state);
                for (const id of Object.keys(state)) {
                    if (accessControls.shouldRejectDevice(id)) {
                        delete state[id];
                        continue;
                    }
                    state[id] = getAccessControlDeviceState(id, state[id]);
                }
            }

            return state;
        }

        await remote.setSystemState(getAccessControlSystemState());
        api.listen((id, eventDetails, eventData) => {
            if (accessControls?.shouldRejectEvent(eventDetails.property === ScryptedInterfaceProperty.id ? eventData : id, eventDetails))
                return;

            // ScryptedDevice events will be handled specially and repropagated by the remote.
            if (eventDetails.eventInterface === ScryptedInterface.ScryptedDevice) {
                if (eventDetails.property === ScryptedInterfaceProperty.id) {
                    // a change on the id property means device was deleted
                    remote.updateDeviceState(eventData, undefined);
                }
                else {
                    // a change on anything else is a descriptor update
                    remote.updateDeviceState(id, getAccessControlDeviceState(id));
                }
                return;
            }

            if (eventDetails.property && !eventDetails.mixinId) {
                remote.notify(id, eventDetails, getSystemState()[id]?.[eventDetails.property]).catch(() => { });
            }
            else {
                remote.notify(id, eventDetails, eventData).catch(() => { });
            }
        });

        return remote;
    }
    catch (e) {
        throw new RPCResultError(peer, 'error while retrieving PluginRemote', e as Error);
    }
}

export interface WebSocketCustomHandler {
    id: string,
    methods: WebSocketMethods;
}

export interface PluginRemoteAttachOptions {
    createMediaManager?: (systemManager: SystemManager, deviceManager: DeviceManagerImpl) => Promise<MediaManager>;
    getServicePort?: (name: string, ...args: any[]) => Promise<[number, string]>;
    getDeviceConsole?: (nativeId?: ScryptedNativeId) => Console;
    getPluginConsole?: () => Console;
    getMixinConsole?: (id: string, nativeId?: ScryptedNativeId) => Console;
    onLoadZip?: (scrypted: ScryptedStatic, params: any, packageJson: any, zipAPI: PluginZipAPI, zipOptions: PluginRemoteLoadZipOptions) => Promise<any>;
    onGetRemote?: (api: PluginAPI, pluginId: string) => Promise<PluginAPI>;
}

export function attachPluginRemote(peer: RpcPeer, options?: PluginRemoteAttachOptions): Promise<ScryptedStatic> {
    const { createMediaManager, getServicePort, getDeviceConsole, getMixinConsole } = options || {};

    if (!peer.constructorSerializerMap.get(Buffer))
        peer.addSerializer(Buffer, 'Buffer', new BufferSerializer());

    const ioSockets: { [id: string]: WebSocketConnectCallbacks } = {};
    const websocketSerializer = new WebSocketSerializer();
    peer.addSerializer(WebSocketConnection, 'WebSocketConnection', websocketSerializer);

    let done: (scrypted: ScryptedStatic) => void;
    const retPromise = new Promise<ScryptedStatic>(resolve => done = resolve);

    peer.params.getRemote = async (api: PluginAPI, pluginId: string, hostInfo: PluginHostInfo) => {
        websocketSerializer.WebSocket = createWebSocketClass((connection, callbacks) => {
            const { url } = connection;
            if (url.startsWith('io://') || url.startsWith('ws://')) {
                const id = url.substring('xx://'.length);

                ioSockets[id] = callbacks;

                callbacks.connect(undefined, {
                    close: (message) => connection.close(message),
                    send: (message) => connection.send(message),
                });
            }
            else {
                throw new Error('unsupported websocket');
            }
        });

        api = await options?.onGetRemote?.(api, pluginId) || api;

        const systemManager = new SystemManagerImpl();
        const deviceManager = new DeviceManagerImpl(systemManager, getDeviceConsole, getMixinConsole);
        const endpointManager = new EndpointManagerImpl();
        const clusterManager = new ClusterManagerImpl(undefined, api, undefined);
        const hostMediaManager = await api.getMediaManager();
        if (!hostMediaManager) {
            peer.params['createMediaManager'] = async () => createMediaManager(systemManager, deviceManager);
        }
        const mediaManager = hostMediaManager || await createMediaManager(systemManager, deviceManager);
        peer.params['mediaManager'] = mediaManager;

        systemManager.api = api;
        deviceManager.api = api;
        const log = deviceManager.getDeviceLogger(undefined);
        systemManager.log = log;

        const ret: ScryptedStatic = {
            systemManager,
            deviceManager,
            endpointManager,
            mediaManager,
            clusterManager,
            log,
            pluginHostAPI: api,
            pluginRemoteAPI: undefined,
            serverVersion: hostInfo?.serverVersion,
            connect: undefined,
            fork: undefined,
            connectRPCObject: undefined,
        };

        delete peer.params.getRemote;

        endpointManager.api = api;
        endpointManager.deviceManager = deviceManager;
        endpointManager.mediaManager = mediaManager;
        endpointManager.pluginId = pluginId;

        const localStorage = new StorageImpl(deviceManager, undefined);

        const remote: PluginRemote & { [RpcPeer.PROPERTY_JSON_DISABLE_SERIALIZATION]: boolean, [RpcPeer.PROPERTY_PROXY_ONEWAY_METHODS]: string[] } = {
            [RpcPeer.PROPERTY_JSON_DISABLE_SERIALIZATION]: true,
            [RpcPeer.PROPERTY_PROXY_ONEWAY_METHODS]: [
                'notify',
                'updateDeviceState',
                'setSystemState',
                'ioEvent',
                'setNativeId',
            ],
            getServicePort,
            async createDeviceState(id: string, setState: (property: string, value: any) => Promise<void>) {
                return deviceManager.createDeviceState(id, setState);
            },

            async ioEvent(id: string, event: string, message?: any) {
                // console.log(id, event, message);
                const io = ioSockets[id];
                if (!io)
                    return;
                switch (event) {
                    case 'message':
                        io.data(message);
                        break;
                    case 'close':
                        io.end();
                        delete ioSockets[id];
                        break;
                }
            },

            async setNativeId(nativeId: ScryptedNativeId, id: string, storage: { [key: string]: any }) {
                // JSON stringify over rpc turns undefined into null.
                if (nativeId === null)
                    nativeId = undefined;
                if (id) {
                    deviceManager.nativeIds.set(nativeId?.toString(), {
                        id,
                        storage,
                    });
                }
                else {
                    deviceManager.nativeIds.delete(nativeId);
                }
            },

            async updateDeviceState(id: string, state: { [property: string]: SystemDeviceState }) {
                if (!state) {
                    delete systemManager.state[id];
                    systemManager.events.notify(undefined, undefined, ScryptedInterface.ScryptedDevice, ScryptedInterfaceProperty.id, id, { changed: true });
                }
                else {
                    systemManager.state[id] = state;
                    systemManager.events.notify(id, undefined, ScryptedInterface.ScryptedDevice, undefined, state, { changed: true });
                }
            },

            async notify(id: string, eventTimeOrDetails: number | EventDetails, eventInterfaceOrData: string | SystemDeviceState | any, property?: string, value?: SystemDeviceState | any, changed?: boolean) {
                if (typeof eventTimeOrDetails === 'number') {
                    // TODO: remove legacy code path
                    // 12/30/2022
                    const eventTime = eventTimeOrDetails as number;
                    const eventInterface = eventInterfaceOrData as string;
                    if (property) {
                        const state = systemManager.state?.[id];
                        if (!state) {
                            log.w(`state not found for ${id}`);
                            return;
                        }
                        state[property] = value;
                        systemManager.events.notify(id, eventTime, eventInterface, property, value.value, { changed });
                    }
                    else {
                        systemManager.events.notify(id, eventTime, eventInterface, property, value, { changed });
                    }
                }
                else {
                    const eventDetails = eventTimeOrDetails as EventDetails;
                    const eventData = eventInterfaceOrData as any;
                    if (eventDetails.property && !eventDetails.mixinId) {
                        const state = systemManager.state?.[id];
                        if (!state) {
                            log.w(`state not found for ${id}`);
                            return;
                        }
                        state[eventDetails.property] = eventData;
                        systemManager.events.notifyEventDetails(id, eventDetails, eventData.value);
                    }
                    else {
                        systemManager.events.notifyEventDetails(id, eventDetails, eventData);
                    }
                }
            },

            async setSystemState(state: { [id: string]: { [property: string]: SystemDeviceState } }) {
                systemManager.state = state;
                deviceManager.pruneMixinStorage();
                done(ret);
            },

            async loadZip(packageJson: any, zipAPI: PluginZipAPI, zipOptions?: PluginRemoteLoadZipOptions) {
                const params: any = {
                    __filename: undefined,
                    deviceManager,
                    systemManager,
                    mediaManager,
                    endpointManager,
                    localStorage,
                    pluginHostAPI: api,
                    // TODO:
                    // 10/10/2022: remove this shim from all plugins and server.
                    WebSocket: function (url: any) {
                        if (typeof url === 'string')
                            throw new Error('unsupported websocket');
                        return url;
                    },
                    pluginRuntimeAPI: ret,
                };

                params.pluginRuntimeAPI = ret;

                try {
                    return await options.onLoadZip(ret, params, packageJson, zipAPI, zipOptions);
                }
                catch (e) {
                    console.error('plugin start/fork failed', e)
                    throw e;
                }
            },
        }

        ret.pluginRemoteAPI = remote;

        return remote;
    }

    return retPromise;
}
