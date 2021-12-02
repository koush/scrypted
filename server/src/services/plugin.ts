import { ScryptedInterfaceProperty, ScryptedNativeId } from "@scrypted/sdk/types";
import { ScryptedRuntime } from "../runtime";
import { Plugin } from '../db-types';
import { getState } from "../state";
import axios from 'axios';
import semver from 'semver';

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
        const pluginDevice = this.scrypted.findPluginDeviceById(id);
        this.scrypted.stateManager.setPluginDeviceState(pluginDevice, ScryptedInterfaceProperty.mixins, [...new Set(mixins)] || []);
        await this.scrypted.datastore.upsert(pluginDevice);
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
    async getIdForNativeId(pluginId: string, nativeId: ScryptedNativeId) {
        return this.scrypted.findPluginDevice(pluginId, nativeId)?._id;
    }
    async getPluginId(id: string) {
        const pluginDevice = this.scrypted.findPluginDeviceById(id);
        return pluginDevice.pluginId;
    }
    async getPluginProcessId(pluginId: string) {
        if (this.scrypted.plugins[pluginId]?.worker?.killed)
            return 'killed';
        return this.scrypted.plugins[pluginId]?.worker?.pid;
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
            pid: host?.worker?.pid,
            stats: host?.stats,
            rpcObjects,
            packageJson: plugin.packageJson,
            id: this.scrypted.findPluginDevice(pluginId),
        }
    }

    async installNpm(pkg: string, version?: string) {
        await this.scrypted.installNpm(pkg, version);
    }

    async npmInfo(endpoint: string) {
        const response = await axios(`https://registry.npmjs.org/${endpoint}`);
        return response.data;
    }

    async updatePlugins() {
        console.log('updating plugins');
        for (const [plugin, host] of Object.entries(this.scrypted.plugins)) {
            try {
                const registry = await this.npmInfo(plugin);
                const version = registry['dist-tags'].latest;
                if (!semver.gt(version, host.packageJson.version)) {
                    console.log('plugin up to date:', plugin);
                    continue;
                }

                console.log('updating plugin', plugin);
                await this.installNpm(plugin);
            }
            catch (e) {
                console.warn('plugin update check or installation failed', e);
            }
        }
        console.log('done updating plugins');
    }

    async getRemoteServicePort(pluginId: string, name: string): Promise<number> {
        if (name === 'console') {
            const consoleServer = await this.scrypted.plugins[pluginId].consoleServer;
            return consoleServer.readPort;
        }
        if (name === 'console-writer') {
            const consoleServer = await this.scrypted.plugins[pluginId].consoleServer;
            return consoleServer.writePort;
        }
        return this.scrypted.plugins[pluginId].remote.getServicePort(name);
    }
}
