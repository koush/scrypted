export interface ClusterObject {
    id: string;
    address: string;
    port: number;
    proxyId: string;
    sourceKey: string;
    sha256: string;
}

export type ConnectRPCObject = (o: ClusterObject) => Promise<any>;
