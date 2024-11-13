import { EventEmitter } from "stream";
import { Deferred } from "../../deferred";
import { RpcPeer } from "../../rpc";
import { ClusterForkOptions, PeerLiveness } from "../../scrypted-cluster";
import type { ClusterFork } from "../../services/cluster-fork";
import { iterateWorkerConsoleError, iterateWorkerConsoleLog } from "../plugin-console";
import type { RuntimeWorker } from "./runtime-worker";

export function createClusterForkWorker(
    console: Console,
    forkComponentPromise: ClusterFork | Promise<ClusterFork>,
    zipHash: string,
    getZip: () => Promise<Buffer>,
    options: ClusterForkOptions,
    packageJson: any,
    connectRPCObject: (o: any) => Promise<any>) {
    const waitKilled = new Deferred<void>();
    waitKilled.promise.finally(() => events.emit('exit'));
    const events = new EventEmitter();

    const runtimeWorker: RuntimeWorker = {
        on: events.on.bind(events),
        once: events.once.bind(events),
        removeListener: events.removeListener.bind(events),
        kill: () => {
            waitKilled.resolve();
        },
    } as any;

    const forkPeer = (async () => {
        const forkComponent = await forkComponentPromise;
        const peerLiveness = new PeerLiveness(new Deferred().promise);
        const clusterForkResult = await forkComponent.fork(peerLiveness, options, packageJson, zipHash, getZip);
        clusterForkResult.waitKilled().catch(() => { })
            .finally(() => {
                waitKilled.resolve();
            });
        waitKilled.promise.finally(() => {
            clusterForkResult.kill();
        });

        try {
            const clusterGetRemote = await connectRPCObject(await clusterForkResult.getResult());
            const {
                stdout,
                stderr,
                getRemote
            } = await clusterGetRemote();

            iterateWorkerConsoleLog(stdout, console).catch(() => { });
            iterateWorkerConsoleError(stderr, console).catch(() => { });

            const directGetRemote = await connectRPCObject(getRemote);
            if (directGetRemote === getRemote)
                throw new Error('cluster fork peer not direct connected');
            const peer = directGetRemote[RpcPeer.PROPERTY_PROXY_PEER];
            if (!peer)
                throw new Error('cluster fork peer undefined?');
            return peer;
        }
        catch (e) {
            clusterForkResult.kill();
        }
    })();

    return {
        runtimeWorker,
        forkPeer,
    }
}