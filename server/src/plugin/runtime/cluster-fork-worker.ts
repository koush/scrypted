import { EventEmitter, PassThrough } from "stream";
import { Deferred } from "../../deferred";
import { RpcPeer } from "../../rpc";
import { ClusterForkOptions, PeerLiveness } from "../../scrypted-cluster-main";
import type { ClusterFork } from "../../services/cluster-fork";
import { writeWorkerGenerator } from "../plugin-console";
import type { RuntimeWorker } from "./runtime-worker";

export function createClusterForkWorker(
    forkComponentPromise: ClusterFork | Promise<ClusterFork>,
    zipHash: string,
    getZip: () => Promise<Buffer>,
    options: ClusterForkOptions,
    packageJson: any,
    connectRPCObject: (o: any) => Promise<any>) {
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

    const forkPeer = (async () => {
        // need to ensure this happens on next tick to prevent unhandled promise rejection.
        // await sleep(0);
        const forkComponent = await forkComponentPromise;
        const peerLiveness = new PeerLiveness(waitKilled.promise);
        const clusterForkResult = await forkComponent.fork(peerLiveness, options, packageJson, zipHash, getZip);
        waitKilled.promise.finally(() => {
            runtimeWorker.pid = undefined;
            clusterForkResult.kill().catch(() => {});
        });
        clusterForkResult.waitKilled().catch(() => { })
            .finally(() => {
                waitKilled.resolve();
            });

        try {
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
        }
        catch (e) {
            clusterForkResult.kill();
            throw e;
        }
    })();

    forkPeer.catch(() => {
        waitKilled.resolve();
    });

    return {
        runtimeWorker,
        forkPeer,
    }
}