<template>
  <div></div>
</template>

<script>
import RPCInterface from "./RPCInterface.vue";

export default {
  mixins: [RPCInterface],
  methods: {
    onChange() {
      this.rpc({
        varargs: true
      }).onEvent();
    }
  }
};
</script>
