import ts, { ScriptTarget } from "typescript";
import sdk, { ScryptedDeviceBase } from "@scrypted/sdk";
import vm from "vm";

const util = require("!!raw-loader!./api/util.ts");
const frigate = require("!!raw-loader!./api/frigate.ts");
const types = require("!!raw-loader!!@scrypted/sdk/types.d.ts");
const libs = {
    frigate,
    types,
    util,
};

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
        const allScripts = Object.values(libs).join('\n').toString() + script;
        const compiled = tsCompile(allScripts);

        const allParams = Object.assign({}, params, {
            systemManager,
            deviceManager,
            endpointManager,
            mediaManager,
            log: device.log,
            console: device.console,
            localStorage: device.storage,
            device,
            exports: {},
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