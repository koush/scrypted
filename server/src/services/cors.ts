import { ScryptedRuntime } from "../runtime";

export interface CORSServer {
    tag: string;
    server: string;
}

export class CORSControl {
    constructor(public runtime: ScryptedRuntime) {
    }

    async getCORS(): Promise<CORSServer[]> {
        return this.runtime.cors;
    }

    async setCORS(servers: CORSServer[]) {
        this.runtime.cors = servers;
    }
}
