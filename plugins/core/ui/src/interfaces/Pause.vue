<template>
  <span>
    <span>
      <v-btn depressed dark tile :outlined="!lazyValue.paused" color="blue" @click="pause">Pause</v-btn>
    </span>
    <span>
      <v-btn depressed dark tile outlined color="green" @click="resume">Resume</v-btn>
    </span>
  </span>
</template>

<script>
import RPCInterface from "./RPCInterface.vue";

export default {
  mixins: [RPCInterface],
  methods: {
    pause() {
      this.lazyValue.paused = true;
      this.rpc().pause();
    },
    resume() {
      this.lazyValue.paused = false;
      this.rpc().resume();
    },
    onChange() {
      this.pause();
    }
  }
};
</script>
