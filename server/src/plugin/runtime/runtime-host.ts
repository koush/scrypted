import type { ScryptedRuntime } from "../../runtime";
import { CustomRuntimeWorker } from "./custom-worker";
import { NodeForkWorker } from "./node-fork-worker";
import { PythonRuntimeWorker } from "./python-worker";
import type { RuntimeWorker, RuntimeWorkerOptions } from "./runtime-worker";

export type RuntimeHost = (mainFilename: string, pluginId: string, options: RuntimeWorkerOptions, runtime: ScryptedRuntime) => RuntimeWorker;

export function getBuiltinRuntimeHosts() {
    const pluginHosts = new Map<string, RuntimeHost>();

    pluginHosts.set('custom', (_, pluginId, options, runtime) => new CustomRuntimeWorker(pluginId, options, runtime));
    pluginHosts.set('python', (_, pluginId, options) => new PythonRuntimeWorker(pluginId, options));
    pluginHosts.set('node', (mainFilename, pluginId, options) => new NodeForkWorker(mainFilename, pluginId, options));

    return pluginHosts;
}
