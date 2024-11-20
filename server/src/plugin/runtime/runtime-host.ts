import type { ScryptedRuntime } from "../../runtime";
import { CustomRuntimeWorker } from "./custom-worker";
import { NodeForkWorker } from "./node-fork-worker";
import { PythonRuntimeWorker } from "./python-worker";
import type { RuntimeWorker, RuntimeWorkerOptions } from "./runtime-worker";

export type RuntimeHost = (mainFilename: string, options: RuntimeWorkerOptions, runtime: ScryptedRuntime) => RuntimeWorker;

export function getBuiltinRuntimeHosts() {
    const pluginHosts = new Map<string, RuntimeHost>();

    pluginHosts.set('custom', (_, options, runtime) => new CustomRuntimeWorker(options, runtime));
    pluginHosts.set('python', (_, options) => new PythonRuntimeWorker(options));
    pluginHosts.set('node', (mainFilename, options) => new NodeForkWorker(mainFilename, options));

    return pluginHosts;
}
