<template>
  <div>
    <div style="height: 500px">
      <div ref="container" style="width: 100%; height: 100%"></div>
    </div>
    <!-- <v-textarea
      label="Script"
      v-model="lazyValue.script"
      outlined
      auto-grow
      @input="onChange"
    ></v-textarea> -->
  </div>
</template>

<script>
import RPCInterface from "../RPCInterface.vue";
import types from "!!raw-loader!@scrypted/sdk/types.d.ts";
import sdk from "!!raw-loader!@scrypted/sdk/index.d.ts";
import * as monaco from "monaco-editor";

monaco.languages.typescript.typescriptDefaults.setCompilerOptions(
  Object.assign(
    {},
    monaco.languages.typescript.typescriptDefaults.getCompilerOptions(),
    {
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    }
  )
);

monaco.languages.typescript.typescriptDefaults.addExtraLib(
  `${types}
  
  declare global {
    ${types.replace('export interface', 'interface')}

    const log: Logger;

    const deviceManager: DeviceManager;
    const endpointManager: EndpointManager;
    const mediaManager: MediaManager;
    const systemManager: SystemManager;
    const eventSource: any;
    const eventDetails: EventDetails;
    const eventData: any;
  }
  `,

  "node_modules/@types/scrypted__sdk/types.d.ts"
);

monaco.languages.typescript.typescriptDefaults.addExtraLib(
  sdk,
  "node_modules/@types/scrypted__sdk/index.d.ts"
);

export default {
  mixins: [RPCInterface],
  mounted() {
    monaco.editor.getModels().forEach((model) => model.dispose());

    if (!this.lazyValue.script) {
      this.lazyValue.script = `// Sample Script:
const device = systemManager.getDeviceByName<OnOff>('My Light');
console.log("turning on ", device.name);
device.turnOn();
`;
    }

    const editor = monaco.editor.create(this.$refs.container, {
      automaticLayout: true,
      theme: "vs-dark",
      minimap: {
        enabled: false,
      },
      model: monaco.editor.createModel(
        this.lazyValue.script,
        "typescript",
        new monaco.Uri("main.ts")
      ),
    });

    editor.onDidChangeModelContent((event) => {
      this.lazyValue.script = editor.getValue();
      this.onChange();
    });
  },
  methods: {
    onChange: function () {
      this.rpc({
        varargs: true,
      }).run(this.lazyValue.script);
    },
  },
};
</script>
