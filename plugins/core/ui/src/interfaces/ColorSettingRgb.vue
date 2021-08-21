<template>
  <v-layout align-center justify-center>
    <ColorPicker style="margin-bottom: 16px;" variant="persistent" v-bind="color" @input="onInputValue" />
  </v-layout>
</template>

<script>
import RPCInterface from "./RPCInterface.vue";
import throttle from "lodash.throttle";
import cloneDeep from "lodash.clonedeep";
import ColorPicker from "@radial-color-picker/vue-color-picker";

export default {
  mixins: [RPCInterface],
  components: {
    ColorPicker
  },
  methods: {
    /**
     * Converts an RGB color value to HSV. Conversion formula
     * adapted from http://en.wikipedia.org/wiki/HSV_color_space.
     * Assumes r, g, and b are contained in the set [0, 255] and
     * returns h, s, and v in the set [0, 1].
     *
     * @param   Number  r       The red color value
     * @param   Number  g       The green color value
     * @param   Number  b       The blue color value
     * @return  Array           The HSV representation
     */
    rgbToHsv(r, g, b) {
      (r /= 255), (g /= 255), (b /= 255);

      var max = Math.max(r, g, b),
        min = Math.min(r, g, b);
      var h,
        s,
        v = max;

      var d = max - min;
      s = max == 0 ? 0 : d / max;

      if (max == min) {
        h = 0; // achromatic
      } else {
        switch (max) {
          case r:
            h = (g - b) / d + (g < b ? 6 : 0);
            break;
          case g:
            h = (b - r) / d + 2;
            break;
          case b:
            h = (r - g) / d + 4;
            break;
        }

        h /= 6;
      }

      return { h, s, v };
    },

    /**
     * Converts an HSV color value to RGB. Conversion formula
     * adapted from http://en.wikipedia.org/wiki/HSV_color_space.
     * Assumes h, s, and v are contained in the set [0, 1] and
     * returns r, g, and b in the set [0, 255].
     *
     * @param   Number  h       The hue
     * @param   Number  s       The saturation
     * @param   Number  v       The value
     * @return  Array           The RGB representation
     */
    hsvToRgb(h, s, v) {
      var r, g, b;

      var i = Math.floor(h * 6);
      var f = h * 6 - i;
      var p = v * (1 - s);
      var q = v * (1 - f * s);
      var t = v * (1 - (1 - f) * s);

      switch (i % 6) {
        case 0:
          (r = v), (g = t), (b = p);
          break;
        case 1:
          (r = q), (g = v), (b = p);
          break;
        case 2:
          (r = p), (g = v), (b = t);
          break;
        case 3:
          (r = p), (g = q), (b = v);
          break;
        case 4:
          (r = t), (g = p), (b = v);
          break;
        case 5:
          (r = v), (g = p), (b = q);
          break;
      }
      return { r: r * 255, g: g * 255, b: b * 255 };
    },
    createLazyValue() {
      var ret = cloneDeep(this.value);
      const { r, g, b } = Object.assign(
        {
          r: 255,
          g: 255,
          b: 255
        },
        this.value.rgb
      );
      const hsv = this.rgbToHsv(r, g, b);
      hsv.h *= 360;
      hsv.s = 1;
      hsv.v = 1;
      ret.hsv = hsv;
      return ret;
    },
    createInputValue() {
      const { h, s, v } = this.lazyValue.hsv;
      const rgb = this.hsvToRgb(h / 360, s, v);
      var ret = cloneDeep(this.lazyValue);
      delete ret.hsv;
      ret.rgb = rgb;
      return ret;
    },
    debounceSetRgb: throttle(function() {
      const { h, s, v } = this.lazyValue.hsv;
      const { r, g, b } = this.hsvToRgb(h / 360, s, v);
      this.rpc().setRgb(r, g, b);
    }, 500),
    onChange() {
      if (this.device) {
        this.debounceSetRgb();
        return;
      }

      const { h, s, v } = this.lazyValue.hsv;
      const { r, g, b } = this.hsvToRgb(h / 360, s, v);
      this.rpc().setRgb(r, g, b);
    },
    onInputValue(h) {
      this.lazyValue.hsv.h = h;
      this.onChange();
    }
  },
  computed: {
    color() {
      return {
        hue: this.lazyValue.hsv.h
        // saturation: 100,
        // luminosity: 100,
      };
    }
  }
};
</script>
<style>
@import "~@radial-color-picker/vue-color-picker/dist/vue-color-picker.min.css";
</style>