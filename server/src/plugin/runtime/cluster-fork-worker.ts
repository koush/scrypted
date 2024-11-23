import type { ClusterFork } from "@scrypted/types";
import { EventEmitter, PassThrough } from "stream";
import { Deferred } from "../../deferred";
import { RpcPeer } from "../../rpc";
import { PeerLiveness } from "../../scrypted-cluster-main";
import type { ClusterForkService } from "../../services/cluster-fork";
import { writeWorkerGenerator } from "../plugin-console";
import type { RuntimeWorker, RuntimeWorkerOptions } from "./runtime-worker";

export function createClusterForkWorker(
    runtimeWorkerOptions: RuntimeWorkerOptions,
    options: Partial<ClusterFork>,
    forkComponentPromise: Promise<ClusterForkService>,
    getZip: () => Promise<Buffer>,
    connectRPCObject: (o: any) => Promise<any>) {

    // these are specific to the cluster worker host
    // and will be set there.
    delete runtimeWorkerOptions.zipFile;
    delete runtimeWorkerOptions.unzippedPath;

    const waitKilled = new Deferred<void>();
    waitKilled.promise.finally(() => events.emit('exit'));
    const events = new EventEmitter();

    const stdout = new PassThrough();
    const stderr = new PassThrough();

    const runtimeWorker: RuntimeWorker = {
        pid: 'cluster',
        stdout,
        stderr,
        on: events.on.bind(events),
        once: events.once.bind(events),
        removeListener: events.removeListener.bind(events),
        kill: () => {
            waitKilled.resolve();
        },
    } as any;

    waitKilled.promise.finally(() => {
        runtimeWorker.pid = undefined;
    });

    const peerLiveness = new PeerLiveness(waitKilled.promise);
    const clusterForkResultPromise = forkComponentPromise.then(forkComponent => forkComponent.fork(runtimeWorkerOptions, {
        runtime: options.runtime || 'node',
        id: options.id,
        ...options,
    }, peerLiveness,
        getZip));
    clusterForkResultPromise.catch(() => { });

    const clusterWorkerId = clusterForkResultPromise.then(clusterForkResult => clusterForkResult.clusterWorkerId);
    clusterWorkerId.catch(() => { });

    const forkPeer = (async () => {
        const clusterForkResult = await clusterForkResultPromise;
        clusterForkResult.waitKilled().catch(() => { })
            .finally(() => {
                waitKilled.resolve();
            });

        const clusterGetRemote = await connectRPCObject(await clusterForkResult.getResult());
        const {
            stdout: stdoutGen,
            stderr: stderrGen,
            getRemote
        } = await clusterGetRemote();

        writeWorkerGenerator(stdoutGen, stdout).catch(() => { });
        writeWorkerGenerator(stderrGen, stderr).catch(() => { });

        const directGetRemote = await connectRPCObject(getRemote);
        if (directGetRemote === getRemote)
            throw new Error('cluster fork peer not direct connected');
        const peer: RpcPeer = directGetRemote[RpcPeer.PROPERTY_PROXY_PEER];
        if (!peer)
            throw new Error('cluster fork peer undefined?');
        return peer;
    })();

    forkPeer.catch(() => {
        waitKilled.resolve();
    });

    return {
        runtimeWorker,
        forkPeer,
        clusterWorkerId,
    }
}