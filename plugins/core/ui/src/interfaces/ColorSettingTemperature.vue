<template>
  <v-slider
    thumb-size="20"
    class="mx-5 mt-2"
    thumb-label="always"
    v-model="lazyValue.colorTemperature"
    @change="onChange"
    dense
  >
    <template v-slot:append>
      <v-icon :color="colors.orange.base"> fa fa-sun </v-icon>
    </template>

    <template v-slot:prepend>
      <v-icon :color="colors.blue.base"> fa fa-snowflake </v-icon>
    </template>
  </v-slider>
</template>

<script>
import RPCInterface from "./RPCInterface.vue";
import throttle from "lodash/throttle";
import colors from "vuetify/es5/util/colors";

export default {
  mixins: [RPCInterface],
  data() {
    return {
      colors,
    };
  },
  methods: {
    debounceSetColorTemperature: throttle(function () {
      this.rpc().setColorTemperature(this.lazyValue.colorTemperature);
    }, 500),
    onChange() {
      if (this.device) {
        this.debounceSetColorTemperature();
        return;
      }
      this.rpc().setColorTemperature(this.lazyValue.colorTemperature);
    },
  },
};
</script>
