import crypto from "crypto";
import { ClusterObject } from "./connect-rpc-object";

export function computeClusterObjectHash(o: ClusterObject, clusterSecret: string) {
    const sha256 = crypto.createHash('sha256').update(`${o.id}${o.address || ''}${o.port}${o.sourceKey || ''}${o.proxyId}${clusterSecret}`).digest().toString('base64');
    return sha256;
}
