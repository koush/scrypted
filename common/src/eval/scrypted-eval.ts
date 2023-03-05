import type { TranspileOptions } from "typescript";
import sdk, { ScryptedDeviceBase, MixinDeviceBase, ScryptedInterface, ScryptedDeviceType } from "@scrypted/sdk";
import vm from "vm";
import fs from 'fs';
import { ScriptDevice } from "./monaco/script-device";
import { ScryptedInterfaceDescriptors } from "@scrypted/sdk";
import fetch from 'node-fetch-commonjs';
import { PluginAPIProxy } from '../../../server/src/plugin/plugin-api';
import { SystemManagerImpl } from '../../../server/src/plugin/system';

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

function getTypeDefs() {
    const scryptedTypesDefs = fs.readFileSync('@types/sdk/types.d.ts').toString();
    const scryptedIndexDefs = fs.readFileSync('@types/sdk/index.d.ts').toString();
    return {
        scryptedIndexDefs,
        scryptedTypesDefs,
    };
}

export async function scryptedEval(device: ScryptedDeviceBase, script: string, extraLibs: { [lib: string]: string }, params: { [name: string]: any }) {
    const libs = Object.assign({
        types: getTypeDefs().scryptedTypesDefs,
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

    const smProxy = new SystemManagerImpl();
    smProxy.state = systemManager.getSystemState();
    const apiProxy = new PluginAPIProxy(sdk.pluginHostAPI);
    smProxy.api = apiProxy;

    const allParams = Object.assign({}, params, {
        sdk,
        fs: require('realfs'),
        fetch,
        ScryptedDeviceBase,
        MixinDeviceBase,
        systemManager: smProxy,
        deviceManager,
        endpointManager,
        mediaManager,
        log: device.log,
        console: device.console,
        localStorage: device.storage,
        device,
        exports: {} as any,
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
            apiProxy,
        };
    }
    catch (e) {
        device.log.e('Error running script.');
        device.console.error(e);
        throw e;
    }
}

export function createMonacoEvalDefaults(extraLibs: { [lib: string]: string }) {
    const bufferTypeDefs = fs.readFileSync('@types/node/buffer.d.ts').toString();

    const safeLibs = {
        bufferTypeDefs,
    };

    const libs = Object.assign(getTypeDefs(), extraLibs);

    function monacoEvalDefaultsFunction(monaco: any, safeLibs: any, libs: any) {
        monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions(
            Object.assign(
                {},
                monaco.languages.typescript.typescriptDefaults.getDiagnosticsOptions(),
                {
                    diagnosticCodesToIgnore: [1108, 1375, 1378],
                }
            )
        );

        monaco.languages.typescript.typescriptDefaults.setCompilerOptions(
            Object.assign(
                {},
                monaco.languages.typescript.typescriptDefaults.getCompilerOptions(),
                {
                    moduleResolution:
                        monaco.languages.typescript.ModuleResolutionKind.NodeJs,
                }
            )
        );

        const catLibs = Object.values(libs).join('\n');
        const catlibsNoExport = Object.keys(libs).filter(lib => lib !== 'sdk')
            .map(lib => libs[lib]).map(lib =>
                lib.toString().replace(/export /g, '').replace(/import.*?/g, ''))
            .join('\n');
        monaco.languages.typescript.typescriptDefaults.addExtraLib(`
        ${catLibs}

        declare global {
            ${catlibsNoExport}

            const log: Logger;

            const deviceManager: DeviceManager;
            const endpointManager: EndpointManager;
            const mediaManager: MediaManager;
            const systemManager: SystemManager;
            const mqtt: MqttClient;
            const device: ScryptedDeviceBase & { pathname : string };
        }
        `,

            "node_modules/@types/scrypted__sdk/types/index.d.ts"
        );

        monaco.languages.typescript.typescriptDefaults.addExtraLib(
            libs['sdk'],
            "node_modules/@types/scrypted__sdk/index.d.ts"
        );

        monaco.languages.typescript.typescriptDefaults.addExtraLib(
            safeLibs.bufferTypeDefs,
            "node_modules/@types/node/buffer.d.ts"
        );
    }

    return `(function() {
    const safeLibs = ${JSON.stringify(safeLibs)};
    const libs = ${JSON.stringify(libs)};

    return (monaco) => {
        (${monacoEvalDefaultsFunction})(monaco, safeLibs, libs);
    }
    })();
    `;
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
