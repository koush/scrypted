import { ScryptedInterfaceProperty } from "@scrypted/sdk/types";
import { ScryptedRuntime } from "../runtime";
import { Plugin } from '../db-types';

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
    async setMetadata(id: string, key: string, value: any) {
        const pluginDevice = this.scrypted.findPluginDeviceById(id);
        const metadata = pluginDevice.state[ScryptedInterfaceProperty.metadata].value || {};
        metadata[key] = value;
        this.scrypted.stateManager.setState(id, ScryptedInterfaceProperty.metadata, metadata);
        await this.scrypted.datastore.upsert(pluginDevice);
    }
    async setStorage(id: string, storage: { [key: string]: string }) {
        const pluginDevice = this.scrypted.findPluginDeviceById(id);
        pluginDevice.storage = storage;
        await this.scrypted.datastore.upsert(pluginDevice);
        const host = this.scrypted.getPluginHostForDeviceId(id);
        await host?.remote?.setNativeId?.(pluginDevice.nativeId, pluginDevice._id, storage);
    }
    async setMixins(id: string, mixins: string[]) {
        const pluginDevice = this.scrypted.findPluginDeviceById(id);
        pluginDevice.mixins = [...new Set(mixins)] || [];
        await this.scrypted.datastore.upsert(pluginDevice);
        const device = this.scrypted.invalidatePluginDevice(id);
        await device.handler.ensureProxy();
    }
    async getMixins(id: string) {
        const pluginDevice = this.scrypted.findPluginDeviceById(id);
        return pluginDevice?.mixins || [];
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
        await this.scrypted.installPlugin(plugin);
    }
    async getPackageJson(pluginId: string) {
        const plugin = await this.scrypted.datastore.tryGet(Plugin, pluginId);
        return plugin.packageJson;
    }
    async getDeviceInfo(id: string) {
        const pluginDevice = this.scrypted.findPluginDeviceById(id);
        return {
            mixins: pluginDevice.mixins || [],
            pluginId: pluginDevice.pluginId,
            storage: pluginDevice.storage,
            nativeId: pluginDevice.nativeId,
        }
    }
    async getPluginInfo(pluginId: string) {
        const plugin = await this.scrypted.datastore.tryGet(Plugin, pluginId);
        return {
            pid: this.scrypted.plugins[pluginId]?.worker?.process.pid,
            packageJson: plugin.packageJson,
            id: this.scrypted.findPluginDevice(pluginId),
        }
    }

    async getRemoteServicePort(pluginId: string, name: string): Promise<number> {
        return this.scrypted.plugins[pluginId].remote.getServicePort(name);
    }
}