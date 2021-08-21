<template>
  <span>
    <span>
      <v-btn
        depressed
        dark
        tile
        :outlined="lazyValue.activate === undefined || lazyValue.activate === false"
        color="green"
        @click="activate"
      >Activate</v-btn>
    </span>
    <span>
      <v-btn
        depressed
        dark
        tile
        :outlined="lazyValue.activate === undefined || lazyValue.activate === true"
        color="red"
        @click="deactivate"
      >Deactivate</v-btn>
    </span>
  </span>
</template>

<script>
import RPCInterface from "./RPCInterface.vue";

export default {
  mixins: [RPCInterface],
  methods: {
    activate() {
      if (!this.device) {
        this.lazyValue.activate = true;
      }
      this.rpc().activate();
    },
    deactivate() {
      if (!this.device) {
        this.lazyValue.activate = false;
      }
      this.rpc().deactivate();
    },
    onChange() {
      this.rpc().activate();
    }
  }
};
</script>
