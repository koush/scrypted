<template>
  <v-flex xs12>
    <v-layout align-center justify-center>
      <ColorPicker
        style="margin-bottom: 16px"
        variant="persistent"
        v-bind="color"
        @input="onInputValue"
      />
    </v-layout>
  </v-flex>
</template>

<script>
import RPCInterface from "./RPCInterface.vue";
import throttle from "lodash/throttle";
import cloneDeep from "lodash/cloneDeep";
import ColorPicker from "@radial-color-picker/vue-color-picker";

export default {
  mixins: [RPCInterface],
  components: {
    ColorPicker,
  },
  methods: {
    createLazyValue() {
      var ret = cloneDeep(this.value);
      ret.hsv = Object.assign(
        {
          h: 360,
          s: 1,
          v: 1,
        },
        {
          h: this.value.hsv && this.value.hsv.h,
        }
      );
      return ret;
    },
    debounceSetHsv: throttle(function () {
      const { h, s, v } = this.lazyValue.hsv;
      this.rpc().setHsv(h, s, v);
    }, 500),
    onChange() {
      if (this.device) {
        this.debounceSetHsv();
        return;
      }

      const { h, s, v } = this.lazyValue.hsv;
      this.rpc().setHsv(h, s, v);
    },
    onInputValue(h) {
      this.lazyValue.hsv.h = h;

      this.onChange();
    },
  },
  computed: {
    color() {
      return {
        hue: this.lazyValue.hsv.h,
        // saturation: 100,
        // luminosity: 100,
      };
    },
  },
};
</script>
<style>
@import "~@radial-color-picker/vue-color-picker/dist/vue-color-picker.min.css";
</style>