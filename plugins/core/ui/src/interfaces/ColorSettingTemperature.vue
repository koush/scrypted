<template>
  <v-slider class="mx-5" thumb-label="always" v-model="lazyValue.colorTemperature" @change="onChange" max="8000" min="2500">
    <template v-slot:append>
      <font-awesome-icon size="sm" icon="snowflake" :color="colors.blue.base"></font-awesome-icon>
    </template>
    <template v-slot:prepend>
      <font-awesome-icon size="sm" icon="sun" :color="colors.orange.base"></font-awesome-icon>
    </template>
  </v-slider>
</template>

<script>
import RPCInterface from "./RPCInterface.vue";
import throttle from "lodash/throttle";
import colors from 'vuetify/es5/util/colors'

export default {
  mixins: [RPCInterface],
  data() {
      return {
          colors,
      }
  },
  methods: {
    debounceSetColorTemperature: throttle(function() {
      this.rpc().setColorTemperature(this.lazyValue.colorTemperature);
    }, 500),
    onChange() {
      if (this.device) {
        this.debounceSetColorTemperature();
        return;
      }
      this.rpc().setColorTemperature(this.lazyValue.colorTemperature);
    }
  }
};
</script>
