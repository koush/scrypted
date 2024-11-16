import { EventDetails, ScryptedNativeId, SystemDeviceState } from '@scrypted/types'
import { PluginRemote, PluginRemoteLoadZipOptions, PluginZipAPI } from './plugin-api';

/**
 * This remote is necessary as the host needs to create a remote synchronously
 * in the constructor and immediately begin queueing commands.
 * Warning: do not await in any of these methods unless necessary, otherwise
 * execution order of state reporting may fail.
 */
 export class LazyRemote implements PluginRemote {
    remote: PluginRemote;

    constructor(public remotePromise: Promise<PluginRemote>, public remoteReadyPromise: Promise<PluginRemote>) {
        this.remoteReadyPromise = (async () => {
            this.remote = await remoteReadyPromise;
            return this.remote;
        })();
        this.remoteReadyPromise.catch(() => {});
    }

    async loadZip(packageJson: any, zipAPI: PluginZipAPI, options?: PluginRemoteLoadZipOptions): Promise<any> {
        if (!this.remote)
            await this.remoteReadyPromise;
        return this.remote.loadZip(packageJson, zipAPI, options);
    }
    async setSystemState(state: { [id: string]: { [property: string]: SystemDeviceState; }; }): Promise<void> {
        if (!this.remote)
            await this.remoteReadyPromise;
        return this.remote.setSystemState(state);
    }
    async setNativeId(nativeId: ScryptedNativeId, id: string, storage: { [key: string]: any; }): Promise<void> {
        if (!this.remote)
            await this.remoteReadyPromise;
        return this.remote.setNativeId(nativeId, id, storage);
    }
    async updateDeviceState(id: string, state: { [property: string]: SystemDeviceState; }): Promise<void> {
        try {
            if (!this.remote)
                await this.remoteReadyPromise;
        }
        catch (e) {
            return;
        }
        return this.remote.updateDeviceState(id, state);
    }
    // TODO: deprecate/clean up this signature
    // 12/30/2022
    async notify(id: string, eventTimeOrDetails: number| EventDetails, eventInterfaceOrData: string | SystemDeviceState | any, property?: string, value?: SystemDeviceState | any, changed?: boolean) {
        try {
            if (!this.remote)
                await this.remoteReadyPromise;
        }
        catch (e) {
            return;
        }
        return this.remote.notify(id, eventTimeOrDetails as any, eventInterfaceOrData, property, value, changed);
    }
    async ioEvent(id: string, event: string, message?: any): Promise<void> {
        if (!this.remote)
            await this.remoteReadyPromise;
        return this.remote.ioEvent(id, event, message);
    }
    async createDeviceState(id: string, setState: (property: string, value: any) => Promise<void>): Promise<any> {
        if (!this.remote)
            await this.remoteReadyPromise;
        return this.remote.createDeviceState(id, setState);
    }

    async getServicePort(name: string, ...args: any[]): Promise<[number, string]> {
        const remote = await this.remotePromise;
        return remote.getServicePort(name, ...args);
    }
}
