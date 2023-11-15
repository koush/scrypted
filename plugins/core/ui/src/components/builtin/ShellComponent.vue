<template>
  <v-card raised>
    <v-toolbar dark color="blue"> Terminal </v-toolbar>
    <div ref="terminal" style="height: 700px"></div>
  </v-card>
</template>
<script>
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { createAsyncQueue } from "@scrypted/common/src/async-queue";

export default {
  mounted() {
    const term = new Terminal({
      theme: this.$vuetify.theme.dark
        ? undefined
        : {
            foreground: "black",
            background: "white",
            cursor: "black",
          },
      convertEol: true,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(this.$refs.terminal);
    fitAddon.fit();

    this.setupShell(term);
  },
  methods: {
    async setupShell(term) {
      const termSvc = await this.$scrypted.systemManager.getDeviceByName("@scrypted/core").getDevice("terminalservice");
      const termSvcDirect = await this.$scrypted.connectRPCObject(termSvc);
      const queue = createAsyncQueue();

      queue.enqueue(JSON.stringify({ interactive: true }));
      queue.enqueue(JSON.stringify({ dim: { cols: term.cols, rows: term.rows } }));

      term.onData(data => queue.enqueue(Buffer.from(data, 'utf8')));
      term.onBinary(data => queue.enqueue(Buffer.from(data, 'binary')));
      term.onResize(dim => queue.enqueue(JSON.stringify({ dim })));

      const localGenerator = queue.queue;
      const remoteGenerator = await termSvcDirect.connectStream(localGenerator);

      for await (const message of remoteGenerator) {
        if (!message) {
          break;
        }
        term.write(new Uint8Array(Buffer.from(message)));
      }
    }
  },
};
</script>