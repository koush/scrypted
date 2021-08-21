<template>
  <span>
    <span>
      <v-btn depressed dark tile :outlined="!value.entryOpen" color="green" @click="openEntry">Open</v-btn>
    </span>
    <span>
      <v-btn depressed dark tile :outlined="value.entryOpen" color="red" @click="closeEntry">Close</v-btn>
    </span>
  </span>
</template>

<script>
import RPCInterface from "./RPCInterface.vue";

export default {
  mixins: [RPCInterface],
  methods: {
    openEntry() {
      this.lazyValue.entryOpen = true;
      this.rpc().openEntry();
    },
    closeEntry() {
      this.lazyValue.entryOpen = false;
      this.rpc().closeEntry();
    },
    onChange() {
      this.rpc().closeEntry();
    }
  }
};
</script>
