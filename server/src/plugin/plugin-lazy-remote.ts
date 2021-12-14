import { ScryptedNativeId, SystemDeviceState } from '@scrypted/sdk/types'
import { PluginRemote, PluginRemoteLoadZipOptions } from './plugin-api';

/**
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
    }

    async loadZip(packageJson: any, zipData: Buffer, options?: PluginRemoteLoadZipOptions): Promise<any> {
        if (!this.remote)
            await this.remoteReadyPromise;
        return this.remote.loadZip(packageJson, zipData, options);
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
    async notify(id: string, eventTime: number, eventInterface: string, property: string, propertyState: SystemDeviceState, changed?: boolean): Promise<void> {
        try {
            if (!this.remote)
                await this.remoteReadyPromise;
        }
        catch (e) {
            return;
        }
        return this.remote.notify(id, eventTime, eventInterface, property, propertyState, changed);
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

    async getServicePort(name: string, ...args: any[]): Promise<number> {
        const remote = await this.remotePromise;
        return remote.getServicePort(name, ...args);
    }
}
