import sdk, { LockState, MixinDeviceBase, PanTiltZoomMovement, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedInterfaceDescriptors, ScryptedMimeTypes } from "@scrypted/sdk";
import { SettingsMixinDeviceBase } from "@scrypted/sdk/settings-mixin";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import fs from 'fs';
import type { TranspileOptions } from "typescript";
import vm from "vm";
import { createMonacoEvalDefaultsWithLibs, ScryptedLibs, StandardLibs } from "./monaco-libs";
import { ScriptDevice } from "./monaco/script-device";

const { systemManager, deviceManager, mediaManager, endpointManager } = sdk;

export async function tsCompile(source: string, options: TranspileOptions = null): Promise<string> {
    const ts = require("typescript");
    const { ScriptTarget } = ts;

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

export function readFileAsString(f: string) {
    return fs.readFileSync(f).toString();;
}

function getScryptedLibs(): ScryptedLibs {
    return {
        "@types/sdk/index.d.ts": readFileAsString('@types/sdk/index.d.ts'),
        "@types/sdk/settings-mixin.d.ts": readFileAsString('@types/sdk/settings-mixin.d.ts'),
        "@types/sdk/storage-settings.d.ts": readFileAsString('@types/sdk/storage-settings.d.ts'),
        "@types/sdk/types.d.ts": readFileAsString('@types/sdk/types.d.ts'),
    }
}

export async function scryptedEval(device: ScryptedDeviceBase, script: string, extraLibs: { [lib: string]: string }, params: { [name: string]: any }) {
    const libs = Object.assign({
        types: getScryptedLibs()['@types/sdk/types.d.ts'],
    }, extraLibs);
    const allScripts = Object.values(libs).join('\n').toString() + script;
    let compiled: string;
    const worker = sdk.fork<{
        tsCompile: typeof tsCompile,
    }>();
    worker.worker.on('error', () => { })
    try {
        const result = await worker.result;
        compiled = await result.tsCompile(allScripts);
    }
    catch (e) {
        device.log.e('Error compiling typescript.');
        device.console.error(e);
        throw e;
    }
    finally {
        worker.worker.terminate();
    }

    const allParams = Object.assign({}, params, {
        sdk,
        ScryptedDeviceBase,
        MixinDeviceBase,
        StorageSettings,
        systemManager,
        deviceManager,
        endpointManager,
        mediaManager,
        log: device.log,
        console: device.console,
        localStorage: device.storage,
        device,
        exports: {} as any,
        PanTiltZoomMovement,
        SettingsMixinDeviceBase,
        ScryptedMimeTypes,
        ScryptedInterface,
        ScryptedDeviceType,
        // @ts-expect-error
        require: __non_webpack_require__,
    });

    const asyncWrappedCompiled = `return (async function() {\n${compiled}\n})`;
    let asyncFunction: any;
    try {
        const functionGenerator = vm.compileFunction(asyncWrappedCompiled, Object.keys(allParams), {
            filename: 'script.js',
        });
        asyncFunction = functionGenerator(...Object.values(allParams));
    }
    catch (e) {
        device.log.e('Error evaluating javascript.');
        device.console.error(e);
        throw e;
    }

    try {
        const value = await asyncFunction();
        const defaultExport = allParams.exports.default;
        return {
            value,
            defaultExport,
        };
    }
    catch (e) {
        device.log.e('Error running script.');
        device.console.error(e);
        throw e;
    }
}

export function createMonacoEvalDefaults(extraLibs: { [lib: string]: string }) {
    const standardlibs: StandardLibs = {
        "@types/node/globals.d.ts": readFileAsString('@types/node/globals.d.ts'),
        "@types/node/buffer.d.ts": readFileAsString('@types/node/buffer.d.ts'),
        "@types/node/process.d.ts": readFileAsString('@types/node/process.d.ts'),
        "@types/node/events.d.ts": readFileAsString('@types/node/events.d.ts'),
        "@types/node/stream.d.ts": readFileAsString('@types/node/stream.d.ts'),
        "@types/node/fs.d.ts": readFileAsString('@types/node/fs.d.ts'),
        "@types/node/net.d.ts": readFileAsString('@types/node/net.d.ts'),
        "@types/node/child_process.d.ts": readFileAsString('@types/node/child_process.d.ts'),
    };

    return createMonacoEvalDefaultsWithLibs(standardlibs, getScryptedLibs(), extraLibs);
}

export interface ScriptDeviceImpl extends ScriptDevice {
    mergeHandler(device: ScryptedDeviceBase): string[];
}

const methodInterfaces = new Map<string, string>();
for (const desc of Object.values(ScryptedInterfaceDescriptors)) {
    for (const method of desc.methods) {
        methodInterfaces.set(method, desc.name);
    }
}

export function createScriptDevice(baseInterfaces: string[]): ScriptDeviceImpl {
    let scriptHandler: any;
    const allInterfaces = baseInterfaces.slice();

    return {
        handle: <T>(handler?: T & object) => {
            scriptHandler = handler;
        },
        handleTypes: (...interfaces: ScryptedInterface[]) => {
            allInterfaces.push(...interfaces);
        },
        mergeHandler: (device: ScryptedDeviceBase) => {
            const handler = scriptHandler || {};
            let keys: string[];
            if (handler.constructor === Object)
                keys = Object.keys(handler);
            else
                keys = Object.getOwnPropertyNames(handler.__proto__);

            for (const method of keys) {
                const iface = methodInterfaces.get(method);
                if (iface) {
                    allInterfaces.push(iface);
                    (device as any)[method] = handler[method].bind(handler);
                }
            }
            return allInterfaces;
        },
    };
}
