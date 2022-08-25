<template>
  <v-switch
    class="mt-0"
    style="margin-bottom: -20px;"
    inset
    :label="device ? undefined : label"
    v-model="lazyValue.on"
    color="info"
    @click.self="onClick"
    @change="onChange"
  ></v-switch>
</template>

<script>
import RPCInterface from "./RPCInterface.vue";

export default {
  mixins: [RPCInterface],
  computed: {
    label() {
      return this.lazyValue.on ? "On" : "Off";
    }
  },
  methods: {
    turnOn: function() {
      this.rpc().turnOn();
    },
    turnOff: function() {
      this.rpc().turnOff();
    },
    onClick() {
      if (!this.device) {
        return;
      }
      // click.self is fired only if it does not change.
      if (this.lazyValue.on) {
        this.turnOn();
      } else {
        this.turnOff();
      }
    },
    onChange: function() {
      if (this.lazyValue.on) {
        this.turnOn();
      } else {
        this.turnOff();
      }
    }
  }
};
</script>
