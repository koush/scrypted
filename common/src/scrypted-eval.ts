import type { TranspileOptions } from "typescript";
import sdk, { ScryptedDeviceBase, ScryptedInterface, ScryptedDeviceType } from "@scrypted/sdk";
import vm from "vm";
import fs from 'fs';
import { newThread } from '../../server/src/threading';

const { systemManager, deviceManager, mediaManager, endpointManager } = sdk;

function tsCompile(source: string, options: TranspileOptions = null): string {
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

async function tsCompileThread(source: string, options: TranspileOptions = null): Promise<string> {
    return newThread({
        source, options,
        customRequire: '__webpack_require__',
    }, ({ source, options }) => {
        const ts = global.require("typescript");
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
    });
}

function getTypeDefs() {
    const scryptedTypesDefs = fs.readFileSync('sdk/types.d.ts').toString();
    const scryptedIndexDefs = fs.readFileSync('sdk/index.d.ts').toString();
    return {
        scryptedIndexDefs,
        scryptedTypesDefs,
    };
}

export async function scryptedEval(device: ScryptedDeviceBase, script: string, extraLibs: { [lib: string]: string }, params: { [name: string]: any }) {
    try {
        const libs = Object.assign({
            types: getTypeDefs().scryptedTypesDefs,
        }, extraLibs);
        const allScripts = Object.values(libs).join('\n').toString() + script;
        const compiled = await tsCompileThread(allScripts);

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
            ScryptedInterface,
            ScryptedDeviceType,
        });

        try {
            const asyncWrappedCompiled = `(async function() {\n${compiled}\n})()`;
            const f = vm.compileFunction(asyncWrappedCompiled, Object.keys(allParams), {
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

export function createMonacoEvalDefaults(extraLibs: { [lib: string]: string }) {
    const libs = Object.assign(getTypeDefs(), extraLibs);

    function monacoEvalDefaultsFunction(monaco, libs) {
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
    }

    return `(function() {
    const libs = ${JSON.stringify(libs)};

    return (monaco) => {
        (${monacoEvalDefaultsFunction})(monaco, libs);
    }
    })();
    `;
}
