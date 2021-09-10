<template>
  <v-card raised>
    <v-toolbar dark color="blue"> Console </v-toolbar>
    <div ref="terminal"></div>
  </v-card>
</template>
<script>
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import eio from "engine.io-client";
import { sleep } from "../common/sleep";

export default {
  props: ["deviceId"],
  socket: null,
  methods: {
    reconnect(term) {
      const endpointPath = `/endpoint/@scrypted/core`;

      const options = {
        path: `${endpointPath}/engine.io/console/${this.deviceId}`,
      };
      const rootLocation = `${window.location.protocol}//${window.location.host}`;
      this.socket = eio(rootLocation, options);

      this.socket.on("message", (data) => term.write(new Uint8Array(data)));
      this.socket.on("close", async () => {
        await sleep(1000);
        this.reconnect(term);
      });
    },
  },
  mounted() {
    const term = new Terminal({
      convertEol: true,
      disableStdin: true,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(this.$refs.terminal);
    fitAddon.fit();

    this.reconnect(term);
  },
  destroyed() {
    this.socket?.close();
  },
};
</script>