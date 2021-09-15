<template>
  <div>
    <v-toolbar dense v-if="testDevice">
      <v-tooltip top>
        <template v-slot:activator="{ on }">
          <v-btn v-on="on" text @click="$emit('save')">
            <v-icon x-small>fa-save</v-icon>
          </v-btn>
        </template>
        <span>Save Script</span>
      </v-tooltip>
      <v-tooltip top>
        <template v-slot:activator="{ on }">
          <v-btn v-on="on" text @click="eval">
            <v-icon x-small>fa-play</v-icon>
          </v-btn>
        </template>
        <span>Run</span>
      </v-tooltip>
      <v-toolbar-title class="ml-2">Script</v-toolbar-title>
    </v-toolbar>
    <div style="height: 300px">
      <div ref="container" style="width: 100%; height: 100%"></div>
    </div>
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
    ${types.replace("export interface", "interface")}

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
  props: ["testDevice", "showSave"],
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
    eval() {
      this.testDevice.eval(this.lazyValue.script);
    },
    onChange: function () {
      this.rpc({
        varargs: true,
      }).run(this.lazyValue.script);
    },
  },
};
</script>
