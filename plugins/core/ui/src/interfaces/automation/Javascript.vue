<template>
  <v-textarea label="Script" v-model="lazyValue.script" outlined auto-grow @input="onChange"></v-textarea>
</template>

<script>
import RPCInterface from "../RPCInterface.vue";

export default {
  mixins: [RPCInterface],
  methods: {
    onChange: function() {
      this.rpc({
        varargs: true
      }).run(this.lazyValue.script);
    }
  }
};
</script>
