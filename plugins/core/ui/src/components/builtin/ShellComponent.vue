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
      term.write(new Uint8Array(Buffer.from(JSON.parse(data).data)));
    });

    term.onData((data) => {
      this.socket.send(JSON.stringify({ data }));
    });

    term.on('resize', dim => {
      this.socket.send(JSON.stringify({ dim }));
    });

    term.onBinary((data) => {
      this.socket.send(JSON.stringify({ data }));
    });
  },
  destroyed() {
    this.socket?.close();
  },
};
</script>