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

    const options = {
      path: `/engine.io/shell`,
    };
    const rootLocation = `${window.location.protocol}//${window.location.host}`;
    this.socket = eio(rootLocation, options);

    this.socket.on("message", (data) => {
      term.write(new Uint8Array(Buffer.from(data)));
    });

    term.onData((data) => {
      this.socket.send(data);
    });

    term.onBinary((data) => {
      this.socket.send(data);
    });
  },
  destroyed() {
    this.socket?.close();
  },
};
</script>