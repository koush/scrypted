
export interface MdnsServiceRecord {
    name: string;
    ttl: number;
    srv: {
        port: number;
        target: string;
        priority?: number | undefined;
        weight?: number | undefined;
    };
    txt: string[];
    type: string;
}
