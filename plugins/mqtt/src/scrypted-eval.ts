import ts, { ScriptTarget } from "typescript";
import sdk, { ScryptedDeviceBase } from "@scrypted/sdk";
import vm from "vm";

const { systemManager, deviceManager, mediaManager, endpointManager } = sdk;

function tsCompile(source: string, options: ts.TranspileOptions = null): string {
    // Default options -- you could also perform a merge, or use the project tsconfig.json
    if (null === options) {
        options = {
            compilerOptions: {
                target: ScriptTarget.ESNext,
                module: ts.ModuleKind.CommonJS
            }
        };
    }
    return ts.transpileModule(source, options).outputText;
}

export async function scryptedEval(device: ScryptedDeviceBase, script: string, params: { [name: string]: any }) {
    try {
        const compiled = tsCompile(script);

        const allParams = Object.assign({}, params, {
            systemManager,
            deviceManager,
            endpointManager,
            mediaManager,
            log: device.log,
            console: device.console,
            localStorage: device.storage,
            device,
        });

        try {
            const f = vm.compileFunction(compiled, Object.keys(allParams), {
                filename: 'script.js',
            });
    
            try {
                return await f(...Object.values(allParams));
            }
            catch (e) {
                device.log.e('Error running script.');
                device.console.error(e);
                throw e;
            }
        }
        catch (e) {
            device.log.e('Error evaluating script.');
            device.console.error(e);
            throw e;
        }
    }
    catch (e) {
        device.log.e('Error compiling script.');
        device.console.error(e);
        throw e;
    }
}