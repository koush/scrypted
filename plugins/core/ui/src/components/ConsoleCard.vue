<template>
  <v-card raised>
    <v-toolbar dark color="blue">
      Console
      <v-tooltip bottom>
        <template v-slot:activator="{ on }">
          <v-btn @click="copy" v-on="on" text
            ><v-icon small> far fa-copy</v-icon>
          </v-btn>
        </template>
        <span>Copy</span>
      </v-tooltip>
      <v-tooltip bottom>
        <template v-slot:activator="{ on }">
          <v-btn v-on="on" text @click="expanded = !expanded">
            <v-icon x-small>fa-angle-double-down</v-icon>
          </v-btn>
        </template>
        <span>Toggle Expand</span>
      </v-tooltip>

      <v-tooltip bottom>
        <template v-slot:activator="{ on }">
          <v-btn @click="clear" v-on="on" text
            ><v-icon small> fas fa-trash</v-icon>
          </v-btn>
        </template>
        <span>Clear</span>
      </v-tooltip>
    </v-toolbar>
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
  buffer: [],
  term: null,
  watch: {
    expanded(oldValue, newValue) {
      if (this.expanded) this.term.resize(this.term.cols, this.term.rows * 2.5);
      else this.term.resize(this.term.cols, this.term.rows / 2.5);
    },
  },
  data() {
    return {
      expanded: false,
    };
  },
  methods: {
    async clear() {
      this.term.clear();
      this.buffer = [];
      const plugins = await this.$scrypted.systemManager.getComponent(
        "plugins"
      );
      plugins.clearConsole(this.deviceId);
    },
    reconnect(term) {
      this.buffer = [];
      const endpointPath = `/endpoint/@scrypted/core`;

      const options = {
        path: `${endpointPath}/engine.io/console/${this.deviceId}`,
      };
      const rootLocation = `${window.location.protocol}//${window.location.host}`;
      this.socket = eio(rootLocation, options);

      this.socket.on("message", (data) => {
        this.buffer.push(Buffer.from(data));
        term.write(new Uint8Array(data));
      });
      this.socket.on("close", async () => {
        await sleep(1000);
        this.reconnect(term);
      });
    },
    copy() {
      this.$copyText(Buffer.concat(this.buffer).toString());
    },
  },
  mounted() {
    const term = new Terminal({
      convertEol: true,
      disableStdin: true,
      scrollback: 10000,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(this.$refs.terminal);
    fitAddon.fit();
    this.term = term;

    this.reconnect(term);
  },
  destroyed() {
    this.socket?.close();
  },
};
</script>