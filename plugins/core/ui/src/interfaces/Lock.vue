<template>
  <span shrink>
    <v-btn class="mx-2" fab @click="unlock" :color="lazyValue.lockState === 'Locked' ? '#a9afbb' : 'orange'" dark>
      <v-icon >lock_open</v-icon>
    </v-btn>
    <v-btn class="mx-2" fab @click="lock" :color="lazyValue.lockState === 'Locked' ? 'green' : '#a9afbb'" dark>
      <v-icon>lock</v-icon>
    </v-btn>
  </span>
</template>

<script>
import RPCInterface from "./RPCInterface.vue";

export default {
  mixins: [RPCInterface],
  methods: {
    lock: function() {
      this.lazyValue.lockState = 'Locked';
      this.onChange();
    },
    unlock: function() {
      this.lazyValue.lockState = 'Unlocked';
      this.onChange();
    },
    onChange: function() {
      // prefer locked in case of error.
      if (this.lazyValue.lockState !== 'Unlocked') {
        this.rpc().lock();
      } else {
        this.rpc().unlock();
      }
    }
  }
};
</script>
