import { MediaObjectCreateOptions } from "@scrypted/types";
import { RpcPeer } from "../rpc";
import { MediaObjectRemote } from "./plugin-api";

export class MediaObject implements MediaObjectRemote {
    __proxy_props: any;

    constructor(public mimeType: string, public data: any, public trusted: boolean, options?: MediaObjectCreateOptions) {
        this.__proxy_props = {
            mimeType,
            trusted,
        };
        options ||= {};
        options!.convert ||= null!;
        options!.toMimeTypes ||= null!;

        for (const [key, value] of Object.entries(options)) {
            if (key in this.__proxy_props || key === '__proxy_props')
                continue;
            if (RpcPeer.isTransportSafe(value))
                this.__proxy_props[key] = value;
            (this as any)[key] = value;
        }
    }

    async getData(): Promise<Buffer | string> {
        return Promise.resolve(this.data);
    }
}
