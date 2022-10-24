import { ScryptedInterfaceProperty, ScryptedNativeId } from "@scrypted/types";
import { ScryptedRuntime } from "../runtime";
import { Plugin } from '../db-types';
import { getState } from "../state";
import axios from 'axios';
import semver from 'semver';
import { sleep } from "../sleep";
import { hasMixinCycle } from "../mixin/mixin-cycle";

export class PluginComponent {
    scrypted: ScryptedRuntime;
    constructor(scrypted: ScryptedRuntime) {
        this.scrypted = scrypted;
    }

    async renameDeviceId(id: string, newId: string) {
        const pluginDevice = this.scrypted.findPluginDeviceById(id);
        await this.kill(pluginDevice.pluginId);
        // wait for everything to settle.
        await sleep(2000);
        // removing will also clear the state.
        const { state } = pluginDevice;
        await this.scrypted.removeDevice(pluginDevice);
        pluginDevice._id = newId;
        pluginDevice.state = state;
        await this.scrypted.datastore.upsert(pluginDevice);
        this.scrypted.pluginDevices[pluginDevice._id] = pluginDevice;
        await this.scrypted.notifyPluginDeviceDescriptorChanged(pluginDevice);
        await this.reload(pluginDevice.pluginId);
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
        mixins = mixins || [];
        if (hasMixinCycle(this.scrypted, id, mixins)) {
            const message = `setMixins: ${id} has a mixin cycle. Cancelling change.`;
            console.warn(message);
            throw new Error(message);
        }
        const pluginDevice = this.scrypted.findPluginDeviceById(id);
        this.scrypted.stateManager.setPluginDeviceState(pluginDevice, ScryptedInterfaceProperty.mixins, [...new Set(mixins)]);
        this.scrypted.stateManager.updateDescriptor(pluginDevice);
        await this.scrypted.datastore.upsert(pluginDevice);
        // device may not exist, so force creation.
        this.scrypted.rebuildPluginDeviceMixinTable(id);
        this.scrypted.getDevice(id);
        await this.scrypted.devices[id]?.handler?.ensureProxy();
    }
    async getIdForPluginId(pluginId: string) {
        return this.scrypted.findPluginDevice(pluginId)?._id;
    }
    async getIdForNativeId(pluginId: string, nativeId: ScryptedNativeId) {
        return this.scrypted.findPluginDevice(pluginId, nativeId)?._id;
    }
    /**
     * @deprecated available as device.pluginId now.
     * Remove at some point after core/ui rolls out 6/20/2022.
     */
    async getPluginId(id: string) {
        const pluginDevice = this.scrypted.findPluginDeviceById(id);
        return pluginDevice.pluginId;
    }
    async reload(pluginId: string) {
        const plugin = await this.scrypted.datastore.tryGet(Plugin, pluginId);
        await this.scrypted.runPlugin(plugin);
    }
    async kill(pluginId: string) {
        return this.scrypted.plugins[pluginId]?.kill();
    }
    async getPackageJson(pluginId: string) {
        return this.scrypted.getPackageJson(pluginId);
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
        const packageJson = await this.getPackageJson(pluginId);
        const host = this.scrypted.plugins[pluginId];
        let rpcObjects = 0;
        let pendingResults = 0;
        if (host.peer) {
            rpcObjects = host.peer.localProxied.size + Object.keys(host.peer.remoteWeakProxies).length;
            pendingResults = Object.keys(host.peer.pendingResults).length;
        }
        return {
            pid: host?.worker?.pid,
            stats: host?.stats,
            rpcObjects,
            packageJson,
            pendingResults,
            id: this.scrypted.findPluginDevice(pluginId)._id,
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
                if (registry?.versions?.[version]?.deprecated) {
                    console.log('plugin deprecated, uninstalling:', plugin);
                    await this.scrypted.removeDevice(this.scrypted.findPluginDevice(plugin));
                    continue;
                }
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

    async clearConsole(id: string) {
        const pluginDevice = this.scrypted.findPluginDeviceById(id);
        const consoleServer = await this.scrypted.plugins[pluginDevice.pluginId].consoleServer;
        consoleServer.clear(pluginDevice.nativeId);
    }

    async getRemoteServicePort(pluginId: string, name: string, ...args: any[]): Promise<number> {
        if (name === 'console') {
            const consoleServer = await this.scrypted.plugins[pluginId].consoleServer;
            return consoleServer.readPort;
        }
        if (name === 'console-writer') {
            const consoleServer = await this.scrypted.plugins[pluginId].consoleServer;
            return consoleServer.writePort;
        }

        return this.scrypted.plugins[pluginId].remote.getServicePort(name, ...args);
    }

    async setHostParam(pluginId: string, name: string, param?: any) {
        const host = this.scrypted.plugins[pluginId];
        if (!host)
            return;

        const key = `oob-param-${name}`;
        if (param === undefined)
            delete host.peer.params[key];
        else
            host.peer.params[key] = param;
    }

    async getHostParam(pluginId: string, name: string) {
        const host = this.scrypted.plugins[pluginId];
        const key = `oob-param-${name}`;
        return host?.peer?.params?.[key];
    }
}
