import { ScryptedInterfaceProperty } from "@scrypted/sdk/types";
import { ScryptedRuntime } from "../runtime";
import { Plugin } from '../db-types';
import { getState } from "../state";

export class PluginComponent {
    scrypted: ScryptedRuntime;
    constructor(scrypted: ScryptedRuntime) {
        this.scrypted = scrypted;
    }

    getNativeId(id: string) {
        return this.scrypted.findPluginDeviceById(id)?.nativeId;
    }
    getStorage(id: string) {
        return this.scrypted.findPluginDeviceById(id)?.storage || {};
    }
    async setStorage(id: string, storage: { [key: string]: string }) {
        const pluginDevice = this.scrypted.findPluginDeviceById(id);
        pluginDevice.storage = storage;
        await this.scrypted.datastore.upsert(pluginDevice);
        const host = this.scrypted.getPluginHostForDeviceId(id);
        await host?.remote?.setNativeId?.(pluginDevice.nativeId, pluginDevice._id, storage);
        this.scrypted.stateManager.notifyInterfaceEvent(pluginDevice, 'Storage', undefined);
    }
    async setMixins(id: string, mixins: string[]) {
        this.scrypted.stateManager.setState(id, ScryptedInterfaceProperty.mixins, [...new Set(mixins)] || []);
        const device = this.scrypted.invalidatePluginDevice(id);
        await device?.handler.ensureProxy();
    }
    async getMixins(id: string) {
        console.warn('legacy use of getMixins, use the mixins property');
        const pluginDevice = this.scrypted.findPluginDeviceById(id);
        return getState(pluginDevice, ScryptedInterfaceProperty.mixins) || [];
    }
    async getIdForPluginId(pluginId: string) {
        return this.scrypted.findPluginDevice(pluginId)?._id;
    }
    async getPluginId(id: string) {
        const pluginDevice = this.scrypted.findPluginDeviceById(id);
        return pluginDevice.pluginId;
    }
    async getPluginProcessId(pluginId: string) {
        return this.scrypted.plugins[pluginId]?.worker?.process.pid;
    }
    async reload(pluginId: string) {
        const plugin = await this.scrypted.datastore.tryGet(Plugin, pluginId);
        await this.scrypted.runPlugin(plugin);
    }
    async kill(pluginId: string) {
        return this.scrypted.plugins[pluginId]?.kill();
    }
    async getPackageJson(pluginId: string) {
        const plugin = await this.scrypted.datastore.tryGet(Plugin, pluginId);
        return plugin.packageJson;
    }
    async getDeviceInfo(id: string) {
        const pluginDevice = this.scrypted.findPluginDeviceById(id);
        return {
            mixins: getState(pluginDevice, ScryptedInterfaceProperty.mixins) || [],
            pluginId: pluginDevice.pluginId,
            storage: pluginDevice.storage,
            nativeId: pluginDevice.nativeId,
        }
    }
    async getPluginInfo(pluginId: string) {
        const plugin = await this.scrypted.datastore.tryGet(Plugin, pluginId);
        const host = this.scrypted.plugins[pluginId];
        let rpcObjects = 0;
        if (host.peer) {
            rpcObjects = host.peer.localProxied.size + Object.keys(host.peer.remoteWeakProxies).length;
        }
        return {
            pid: host?.worker?.process.pid,
            stats: host?.stats,
            rpcObjects,
            packageJson: plugin.packageJson,
            id: this.scrypted.findPluginDevice(pluginId),
        }
    }

    async getRemoteServicePort(pluginId: string, name: string): Promise<number> {
        return this.scrypted.plugins[pluginId].remote.getServicePort(name);
    }
}
