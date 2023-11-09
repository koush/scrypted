import crypto from "crypto";

export interface ClusterObject {
    id: string;
    port: number;
    proxyId: string;
    sourcePort: number;
    sha256: string;
}

export type ConnectRPCObject = (o: ClusterObject) => Promise<any>;

export function computeClusterObjectHash(o: ClusterObject, clusterSecret: string) {
    const sha256 = crypto.createHash('sha256').update(`${o.id}${o.port}${o.sourcePort || ''}${o.proxyId}${clusterSecret}`).digest().toString('base64');
    return sha256;
}
