<template>
  <v-card raised>
    <v-toolbar dark color="blue">{{ title }}
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
            ><v-icon small>fas fa-trash</v-icon>
          </v-btn>
        </template>
        <span>Clear</span>
      </v-tooltip>
    </v-toolbar>
    <div ref="terminal"></div>
  </v-card>
</template>
<script>
import { createAsyncQueue } from "@scrypted/common/src/async-queue";
import { Deferred } from "@scrypted/common/src/deferred";
import { sleep } from "@scrypted/common/src/sleep";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";

export default {
  term: null,
  buffer: [],
  unmounted: null,
  props: {
    nativeId: String,
    title: String,
    // data sent to the pty service (repl/console) to route to correct device.
    hello: String,
    options: Object,
    control: Boolean,
    copyButton: Boolean,
    clearButton: Boolean,
    reconnect: Boolean,
  },
  destroyed() {
    this.unmounted.resolve();
  },
  mounted() {
    this.unmounted = new Deferred();
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
    this.term = term;
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(this.$refs.terminal);
    fitAddon.fit();

    this.connectPty(term);
  },
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
      this.$emit("clear");
    },
    copy() {
      this.$copyText(Buffer.concat(this.buffer).toString());
    },
    async connectPty(term) {
      this.buffer = [];

      const termSvcRaw = this.$scrypted.systemManager.getDeviceByName("@scrypted/core");
      const termSvc = await termSvcRaw.getDevice(this.$props.nativeId);
      const termSvcDirect = await this.$scrypted.connectRPCObject(termSvc);
      const dataQueue = createAsyncQueue();
      this.unmounted.promise.then(() => dataQueue.end());

      if (this.$props.hello) {
        const hello = Buffer.from(this.$props.hello, 'utf8');
        dataQueue.enqueue(hello);
      }

      const ctrlQueue = createAsyncQueue();
      if (!this.$props.control)
        ctrlQueue.end();

      ctrlQueue.enqueue({ interactive: true });
      ctrlQueue.enqueue({ dim: { cols: term.cols, rows: term.rows } });

      let bufferedLength = 0;
      const MAX_BUFFERED_LENGTH = 64000;
      async function dataQueueEnqueue(data) {
        bufferedLength += data.length;
        const promise = dataQueue.enqueue(data).then(() => bufferedLength -= data.length);
        if (bufferedLength >= MAX_BUFFERED_LENGTH) {
          term.setOption("disableStdin", true);
          await promise;
          if (bufferedLength < MAX_BUFFERED_LENGTH)
            term.setOption("disableStdin", false);
        }
      }

      term.onData(data => dataQueueEnqueue(Buffer.from(data, 'utf8')));
      term.onBinary(data => dataQueueEnqueue(Buffer.from(data, 'binary')));
      term.onResize(dim => {
        ctrlQueue.enqueue({ dim });
        ctrlQueue.enqueue(Buffer.alloc(0));
      });

      async function* localGenerator() {
        while (true) {
          const ctrlBuffers = ctrlQueue.clear();
          if (ctrlBuffers.length) {
            for (const ctrl of ctrlBuffers) {
              yield JSON.stringify(ctrl);
            }
            continue;
          }

          const dataBuffers = dataQueue.clear();
          if (dataBuffers.length === 0) {
            const buf = await dataQueue.dequeue();
            if (buf.length)
              yield buf;
            continue;
          }

          const concat = Buffer.concat(dataBuffers);
          if (concat.length)
            yield concat;
        }
      }
      const remoteGenerator = await termSvcDirect.connectStream(localGenerator(), this.$props.options);

      try {
          for await (const message of remoteGenerator) {
          if (!message) {
            break;
          }
          const buffer = Buffer.from(message);
          if (this.$props.copyButton) {
            this.buffer.push(buffer);
          }
          term.write(new Uint8Array(message));
        }

      }
      finally {
        if (!this.$props.reconnect)
          return;
        await sleep(1000);
        if (this.unmounted.finished)
          return;
        this.connectPty(term);
      }
    }
  },
};
</script>