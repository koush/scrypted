export interface ClusterObject {
    /**
     * Id of the cluster.
     */
    id: string;
    /**
     * Address of the process that created this object.
     */
    address: string;
    /**
     * Port of the process that created this object.
     */
    port: number;
    /**
     * Id of the object within the source peer.
     */
    proxyId: string;
    /**
     * Id of the source peer.
     */
    sourceKey: string;
    /**
     * Hash of the object.
     */
    sha256: string;
}

export type ConnectRPCObject = (o: ClusterObject) => Promise<any>;
