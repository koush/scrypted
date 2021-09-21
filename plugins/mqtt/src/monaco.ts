const libs = {
    types: require("!!raw-loader!@scrypted/sdk/types.d.ts"),
    sdk: require("!!raw-loader!@scrypted/sdk/index.d.ts"),
    client: require("!!raw-loader!./api/mqtt-client.ts"),
    frigate: require("!!raw-loader!./api/frigate.ts"),
};

function monacoEvalDefaultsFunction(monaco, libs) {
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
    const catlibsNoExport = Object.keys(libs).filter(lib => lib !== 'sdk').map(lib => libs[lib]).map(lib => lib.toString().replace(/export /g, '')).join('\n');
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

        "node_modules/@types/scrypted__sdk/types.d.ts"
    );

    monaco.languages.typescript.typescriptDefaults.addExtraLib(
        libs['sdk'],
        "node_modules/@types/scrypted__sdk/index.d.ts"
    );
}

export const monacoEvalDefaults = `(function() {
const libs = ${JSON.stringify(libs)};

return (monaco) => {
    (${monacoEvalDefaultsFunction})(monaco, libs);
} 
})();
`;
