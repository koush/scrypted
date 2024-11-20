import { EndpointAccessControlAllowOrigin, MediaManager, ScryptedMimeTypes, type EndpointManager, type ScryptedNativeId } from "@scrypted/types";
import type { DeviceManagerImpl } from "./device";
import type { PluginAPI } from "./plugin-api";

export class EndpointManagerImpl implements EndpointManager {
    deviceManager: DeviceManagerImpl;
    api: PluginAPI;
    pluginId: string;
    mediaManager: MediaManager;

    getEndpoint(nativeId?: ScryptedNativeId) {
        if (!nativeId)
            return this.pluginId;
        const id = this.deviceManager.nativeIds.get(nativeId)?.id;
        if (!id)
            throw new Error('invalid nativeId ' + nativeId);
        if (!nativeId)
            return this.pluginId;
        return id;
    }

    async getUrlSafeIp() {
        // ipv6 addresses have colons and need to be bracketed for url safety
        const ip: string = await this.api.getComponent('SCRYPTED_IP_ADDRESS')
        return ip?.includes(':') ? `[${ip}]` : ip;
    }

    /**
     * @deprecated
     */
    async getAuthenticatedPath(nativeId?: ScryptedNativeId): Promise<string> {
        return this.getPath(nativeId);
    }

    /**
     * @deprecated
     */
    async getInsecurePublicLocalEndpoint(nativeId?: ScryptedNativeId): Promise<string> {
        return this.getLocalEndpoint(nativeId, {
            insecure: true,
            public: true,
        })
    }

    /**
     * @deprecated
     */
    async getPublicCloudEndpoint(nativeId?: ScryptedNativeId): Promise<string> {
        return this.getCloudEndpoint(nativeId, {
            public: true,
        });
    }

    /**
     * @deprecated
     */
    async getPublicLocalEndpoint(nativeId?: ScryptedNativeId): Promise<string> {
        return this.getLocalEndpoint(nativeId, {
            public: true,
        })
    }

    /**
     * @deprecated
     */
    async getPublicPushEndpoint(nativeId?: ScryptedNativeId): Promise<string> {
        const mo = await this.mediaManager.createMediaObject(Buffer.from(this.getEndpoint(nativeId)), ScryptedMimeTypes.PushEndpoint);
        return this.mediaManager.convertMediaObjectToUrl(mo, ScryptedMimeTypes.PushEndpoint);
    }

    async getPath(nativeId?: string, options?: { public?: boolean; }): Promise<string> {
        return `/endpoint/${this.getEndpoint(nativeId)}/${options?.public ? 'public/' : ''}`
    }

    async getLocalEndpoint(nativeId?: string, options?: { public?: boolean; insecure?: boolean; }): Promise<string> {
        const protocol = options?.insecure ? 'http' : 'https';
        const port = await this.api.getComponent(options?.insecure ? 'SCRYPTED_INSECURE_PORT' : 'SCRYPTED_SECURE_PORT');
        const path = await this.getPath(nativeId, options);
        const url = `${protocol}://${await this.getUrlSafeIp()}:${port}${path}`;
        return url;
    }

    async getCloudEndpoint(nativeId?: string, options?: { public?: boolean; }): Promise<string> {
        const local = await this.getLocalEndpoint(nativeId, options);
        const mo = await this.mediaManager.createMediaObject(Buffer.from(local), ScryptedMimeTypes.LocalUrl);
        return this.mediaManager.convertMediaObjectToUrl(mo, ScryptedMimeTypes.LocalUrl);
    }

    async getCloudPushEndpoint(nativeId?: string): Promise<string> {
        const mo = await this.mediaManager.createMediaObject(Buffer.from(this.getEndpoint(nativeId)), ScryptedMimeTypes.PushEndpoint);
        return this.mediaManager.convertMediaObjectToUrl(mo, ScryptedMimeTypes.PushEndpoint);
    }

    async setLocalAddresses(addresses: string[]): Promise<void> {
        const addressSettings = await this.api.getComponent('addresses');
        return addressSettings.setLocalAddresses(addresses);
    }

    async getLocalAddresses(): Promise<string[]> {
        const addressSettings = await this.api.getComponent('addresses');
        return await addressSettings.getLocalAddresses() as string[];
    }

    async setAccessControlAllowOrigin(options: EndpointAccessControlAllowOrigin): Promise<void> {
        const self = this;
        const setAccessControlAllowOrigin = await this.deviceManager.systemManager.getComponent('setAccessControlAllowOrigin') as typeof self.setAccessControlAllowOrigin;
        return setAccessControlAllowOrigin(options);
    }
}
