import { MediaObjectOptions } from "@scrypted/types";
import { RpcPeer } from "../rpc";
import { MediaObjectRemote } from "./plugin-api";

export class MediaObject implements MediaObjectRemote {
    __proxy_props: any;

    constructor(public mimeType: string, public data: any, options: MediaObjectOptions) {
        this.__proxy_props = {}
        options ||= {};
        options.mimeType = mimeType;
        for (const [key, value] of Object.entries(options)) {
            if (RpcPeer.isTransportSafe(value))
                this.__proxy_props[key] = value;
            (this as any)[key] = value;
        }
    }

    async getData(): Promise<Buffer | string> {
        return Promise.resolve(this.data);
    }
}
