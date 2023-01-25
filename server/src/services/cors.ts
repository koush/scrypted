import { ScryptedRuntime } from "../runtime";

export class CORSControl {
    origins: {
        [id: string]: string[],
    } = {};

    constructor(public runtime: ScryptedRuntime) {
    }

    async getCORS(id: string): Promise<string[]> {
        return this.origins[id] || [];
    }

    async setCORS(id: string, origins: string[]) {
        this.origins[id] = origins;
    }
}


export interface CORSServerLegacy {
    tag: string;
    server: string;
}

export interface CORSControlLegacy {
    getCORS(): Promise<CORSServerLegacy[]>;
    setCORS(servers: CORSServerLegacy[]): Promise<void>;
}
