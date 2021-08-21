<template>
  <span>
    <span>
      <v-btn depressed dark tile :outlined="!value.running" color="green" @click="start">Start</v-btn>
    </span>
    <span>
      <v-btn depressed dark tile :outlined="value.running" color="red" @click="stop">Stop</v-btn>
    </span>
  </span>
</template>

<script>
import RPCInterface from "./RPCInterface.vue";

export default {
  mixins: [RPCInterface],
  methods: {
    start() {
      this.lazyValue.running = true;
      this.rpc().start();
    },
    stop() {
      this.lazyValue.running = false;
      this.rpc().stop();
    },
    onChange() {
      this.rpc().stop();
    }
  }
};
</script>
