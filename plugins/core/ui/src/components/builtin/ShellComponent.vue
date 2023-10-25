<template>
  <v-card raised>
    <v-toolbar dark color="blue"> Terminal </v-toolbar>
    <div ref="terminal" style="height: 700px"></div>
  </v-card>
</template>
<script>
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import eio from "engine.io-client";
import { getCurrentBaseUrl } from "../../../../../../packages/client/src";

export default {
  socket: null,
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

    const baseUrl = getCurrentBaseUrl();
    const eioPath = `engine.io/shell`;
    const eioEndpoint = baseUrl ? new URL(eioPath, baseUrl).pathname : '/' + eioPath;
    const options = {
      path: eioEndpoint,
    };
    const rootLocation = `${window.location.protocol}//${window.location.host}`;
    this.socket = eio(rootLocation, options);

    this.socket.send(JSON.stringify({ dim: { cols: term.cols, rows: term.rows } }));

    this.socket.on("message", (data) => {
      term.write(new Uint8Array(Buffer.from(data)));
    });

    term.onData((data) => {
      this.socket.send(JSON.stringify({ d: data }));
    });

    term.onBinary((data) => {
      // https://github.com/xtermjs/xterm.js/blob/2e02c37e528c1abc200ce401f49d0d7eae330e63/typings/xterm.d.ts#L859-L868
      this.socket.send(Buffer.from(data, 'binary'));
    });

    term.on('resize', dim => {
      this.socket.send(JSON.stringify({ dim }));
    });
  },
  destroyed() {
    this.socket?.close();
  },
};
</script>