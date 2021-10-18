<template>
  <div>
    <v-toolbar dense>
      <v-tooltip top v-if="device">
        <template v-slot:activator="{ on }">
          <v-btn v-on="on" text @click="save">
            <v-icon x-small>fa-save</v-icon>
          </v-btn>
        </template>
        <span>Save</span>
      </v-tooltip>
      <v-tooltip top v-if="device"
        >>
        <template v-slot:activator="{ on }">
          <v-btn v-on="on" text @click="eval">
            <v-icon x-small>fa-play</v-icon>
          </v-btn>
        </template>
        <span>Run</span>
      </v-tooltip>
      <v-toolbar-title class="ml-2">{{
        scriptSource.scriptTitle
      }}</v-toolbar-title>
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

function monacoEvalDefaults() {
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

  monaco.languages.typescript.typescriptDefaults.addExtraLib(
    `${types}
    ${sdk}
    
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
}

export default {
  mixins: [RPCInterface],
  mounted() {
    this.reload();
  },
  data() {
    return {
      scriptSource: {
        filename: "script.ts",
        script: '',
        scriptTitle: "Script",
        language: "typescript",
        monacoEvalDefaults: () => monacoEvalDefaults,
      },
    };
  },
  methods: {
    async reload() {
      monaco.editor.getModels().forEach((model) => model.dispose());

      if (this.device) {
        const scripts = await this.device.loadScripts();
        this.scriptSource.filename = Object.keys(scripts)[0];
        this.scriptSource.script =
          scripts[this.scriptSource.filename].script?.toString();
        this.scriptSource.scriptTitle =
          scripts[this.scriptSource.filename].name?.toString();
        this.scriptSource.language =
          scripts[this.scriptSource.filename].language || "typescript";
        this.scriptSource.monacoEvalDefaults = () =>
          eval(
            scripts[
              this.scriptSource.filename
            ].monacoEvalDefaults?.toString() || ""
          );
      } else {
        this.scriptSource.filename =
          Object.keys(this.lazyValue).filter((k) => k !== "rpc")[0] ||
          this.scriptSource.filename;
        this.scriptSource.script =
          this.lazyValue[this.scriptSource.filename]?.toString();
      }

      const editor = monaco.editor.create(this.$refs.container, {
        automaticLayout: true,
        theme: "vs-dark",
        minimap: {
          enabled: false,
        },
        model: monaco.editor.createModel(
          this.scriptSource.script,
          this.scriptSource.language,
          new monaco.Uri(this.scriptSource.filename)
        ),
      });

      editor.onDidChangeModelContent((event) => {
        if (this.device) {
          this.scriptSource.script = editor.getValue();
        } else {
          this.lazyValue[this.scriptSource.filename] = editor.getValue();
          this.save();
        }
      });

      const f = this.scriptSource.monacoEvalDefaults?.();
      f?.(monaco);
    },
    eval() {
      this.device.eval({
        script: this.scriptSource.script,
      });
    },
    onChange() {
      if (!this.device) this.save();
    },
    save() {
      this.rpc({
        varargs: true,
      }).saveScript(this.scriptSource);
    },
  },
};
</script>
