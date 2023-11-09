export interface ClusterObject {
    id: string;
    port: number;
    proxyId: string;
    sourcePort: number;
    sha256: string;
}

export type ConnectRPCObject = (o: ClusterObject) => Promise<any>;
