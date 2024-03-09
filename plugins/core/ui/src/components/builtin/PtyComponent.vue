<template>
  <v-card raised>
    <v-toolbar dark color="blue">{{ title }}</v-toolbar>
    <div ref="terminal" style="height: 700px"></div>
  </v-card>
</template>
<script>
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { createAsyncQueue } from "@scrypted/common/src/async-queue";

export default {
  props: {
    nativeId: String,
    title: String,
    // data sent to the pty service (repl/console) to route to correct device.
    hello: String,
    options: Object,
    control: Boolean,
  },
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
      const termSvcRaw = this.$scrypted.systemManager.getDeviceByName("@scrypted/core");
      const termSvc = await termSvcRaw.getDevice(this.$props.nativeId);
      const termSvcDirect = await this.$scrypted.connectRPCObject(termSvc);
      const dataQueue = createAsyncQueue();

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