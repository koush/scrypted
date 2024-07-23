import type * as monacoEditor from 'monaco-editor';

export interface StandardLibs {
    '@types/node/globals.d.ts': string,
    '@types/node/buffer.d.ts': string,
    '@types/node/process.d.ts': string,
    '@types/node/events.d.ts': string,
    '@types/node/stream.d.ts': string,
    '@types/node/fs.d.ts': string,
    '@types/node/net.d.ts': string,
    '@types/node/child_process.d.ts': string,
}

export interface ScryptedLibs {
    '@types/sdk/settings-mixin.d.ts': string,
    '@types/sdk/storage-settings.d.ts': string,
    '@types/sdk/types.d.ts': string,
    '@types/sdk/index.d.ts': string,
}

export function createMonacoEvalDefaultsWithLibs(standardLibs: StandardLibs, scryptedLibs: ScryptedLibs, extraLibs: { [lib: string]: string }) {
    // const libs = Object.assign(scryptedLibs, extraLibs);

    function monacoEvalDefaultsFunction(monaco: typeof monacoEditor, standardLibs: StandardLibs, scryptedLibs: ScryptedLibs, extraLibs: { [lib: string]: string }) {
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

        const libs: any = {
            ...scryptedLibs,
            ...extraLibs,
        };

        const catLibs = Object.values(libs).join('\n');
        const catlibsNoExport = Object.keys(libs)
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

            const eventSource: ScryptedDevice;
            const eventDetails: EventDetails;
            const eventData: any;
        }
        `,

            "node_modules/@types/scrypted__sdk/types/index.d.ts"
        );

        for (const lib of Object.keys(standardLibs)) {
            monaco.languages.typescript.typescriptDefaults.addExtraLib(
                standardLibs[lib as keyof StandardLibs],
                lib,
            );
        }
    }

    return `(function() {
    const standardLibs = ${JSON.stringify(standardLibs)};
    const scryptedLibs = ${JSON.stringify(scryptedLibs)};
    const extraLibs = ${JSON.stringify(extraLibs)};

    return (monaco) => {
        (${monacoEvalDefaultsFunction})(monaco, standardLibs, scryptedLibs, extraLibs);
    }
    })();
    `;
}
