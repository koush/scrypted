
const types = require("!!raw-loader!@scrypted/sdk/types.d.ts");
const sdk = require("!!raw-loader!@scrypted/sdk/index.d.ts");
const client = require("!!raw-loader!./mqtt-client.ts");

function monacoEvalDefaultsFunction(monaco) {
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

    monaco.languages.typescript.typescriptDefaults.addExtraLib(`
      ${types}
      ${sdk}
      ${client}

      declare global {
        ${types.replace("export interface", "interface")}
        ${client.replace("export interface", "interface")}

        const log: Logger;
  
        const deviceManager: DeviceManager;
        const endpointManager: EndpointManager;
        const mediaManager: MediaManager;
        const systemManager: SystemManager;
        const mqtt: MqttClient;
        const device: ScryptedDeviceBase;
      }
      `,

        "node_modules/@types/scrypted__sdk/types.d.ts"
    );

    monaco.languages.typescript.typescriptDefaults.addExtraLib(
        sdk,
        "node_modules/@types/scrypted__sdk/index.d.ts"
    );
}

export const monacoEvalDefaults = `(function() {
const types = \`${types}\`;
const sdk = \`${sdk}\`;
const client = \`${client}\`;

return ${monacoEvalDefaultsFunction};
})();
`;
