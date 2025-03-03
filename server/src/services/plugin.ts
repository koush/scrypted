import { ScryptedInterfaceProperty, ScryptedNativeId } from "@scrypted/types";
import semver from 'semver';
import { Plugin } from '../db-types';
import { httpFetch } from "../fetch/http-fetch";
import { hasMixinCycle } from "../mixin/mixin-cycle";
import { ScryptedRuntime } from "../runtime";
import { sleep } from "../sleep";
import { getState } from "../state";


export async function getNpmPackageInfo(pkg: string) {
    const { body } = await httpFetch({
        url: `https://registry.npmjs.org/${pkg}`,
        // force ipv4 in case of busted ipv6.
        family: 4,
        responseType: 'json',
    });
    return body;
}

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

    getStorage(id: string) {
        return this.scrypted.findPluginDeviceById(id)?.storage || {};
    }

    async setStorage(id: string, storage: { [key: string]: string }) {
        const pluginDevice = this.scrypted.findPluginDeviceById(id);
        pluginDevice.storage = storage;
        await this.scrypted.datastore.upsert(pluginDevice);
        const host = this.scrypted.getPluginHostForDeviceId(id);
        await host?.remote?.setNativeId?.(pluginDevice.nativeId, pluginDevice._id, storage);
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
    async reload(pluginId: string) {
        const plugin = await this.scrypted.datastore.tryGet(Plugin, pluginId);
        await this.scrypted.runPlugin(plugin);
    }
    async kill(pluginId: string) {
        return this.scrypted.plugins[pluginId]?.kill();
    }
    // TODO: Remove this, ScryptedPlugin exists now.
    // 12/29/2022
    async getPackageJson(pluginId: string) {
        return this.scrypted.getPackageJson(pluginId);
    }
    async getDeviceInfo(id: string) {
        const pluginDevice = this.scrypted.findPluginDeviceById(id);
        if (!pluginDevice)
            throw new Error(`device ${id} does not exist`);
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
        const pendingResultMethods: {
            [method: string]: number,
        } = {};
        if (host.peer) {
            rpcObjects = host.peer.localProxied.size + Object.keys(host.peer.remoteWeakProxies).length;
            pendingResults = Object.keys(host.peer.pendingResults).length;
            for (const deferred of Object.values(host.peer.pendingResults)) {
                pendingResultMethods[deferred.method] = (pendingResultMethods[deferred.method] || 0) + 1;
            }
        }
        return {
            pid: host?.worker?.pid,
            clientsCount: host?.io?.clientsCount,
            rpcObjects,
            packageJson,
            pendingResults,
            pendingResultCounts: pendingResultMethods,
            id: this.scrypted.findPluginDevice(pluginId)._id,
        }
    }

    async disconnectClients(pluginId: string) {
        const host = this.scrypted.plugins[pluginId];
        if (!host)
            return;
        const { clients } = host.io as any;
        for (const client of Object.values(clients)) {
            (client as any).close()
        }
    }

    async installNpm(pkg: string, version?: string) {
        await this.scrypted.installNpm(pkg, version);
    }

    async npmInfo(endpoint: string) {
        return getNpmPackageInfo(endpoint);
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

    async getRemoteServicePort(pluginId: string, name: string, ...args: any[]): Promise<[number, string]> {
        if (name === 'console') {
            const consoleServer = await this.scrypted.plugins[pluginId].consoleServer;
            return [consoleServer.readPort, process.env.SCRYPTED_CLUSTER_ADDRESS];
        }
        if (name === 'console-writer') {
            const consoleServer = await this.scrypted.plugins[pluginId].consoleServer;
            return [consoleServer.writePort, process.env.SCRYPTED_CLUSTER_ADDRESS];
        }

        return this.scrypted.plugins[pluginId].remote.getServicePort(name, ...args);
    }
}
