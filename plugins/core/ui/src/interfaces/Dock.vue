<template>
  <span>
    <v-btn depressed dark tile :outlined="!value.docked" color="blue" @click="dock">Dock</v-btn>
  </span>
</template>

<script>
import RPCInterface from "./RPCInterface.vue";

export default {
  mixins: [RPCInterface],
  methods: {
    dock() {
      this.rpc().dock();
    },
    onChange() {
      this.rpc().dock();
    }
  }
};
</script>
