<template>
  <v-slider class="mx-5" thumb-label="always" v-model="lazyValue.brightness" @change="onChange"
  
        append-icon="brightness_high"
        prepend-icon="brightness_low"
  ></v-slider>
</template>

<script>
import RPCInterface from "./RPCInterface.vue";
import throttle from "lodash.throttle";

export default {
  mixins: [RPCInterface],
  methods: {
    debounceSetBrightness: throttle(function() {
      this.rpc().setBrightness(this.lazyValue.brightness);
    }, 500),
    onChange() {
      if (this.device) {
        this.debounceSetBrightness();
        return;
      }
      this.rpc().setBrightness(this.lazyValue.brightness);
    }
  }
};
</script>
