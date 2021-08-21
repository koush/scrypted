<template>
  <span>
    <font-awesome-icon class="white--text mr-2 ml-2" size="sm" :icon="batteryIcon" color="#a9afbb" />
    <span class="caption mr-2">{{ lazyValue.batteryLevel }}%</span>
  </span>
</template>

<script>
import RPCInterface from "./RPCInterface.vue";

export default {
  mixins: [RPCInterface],
  computed: {
    batteryIcon() {
      if (this.lazyValue.batteryLevel > 80) {
        return "battery-full";
      }
      if (this.lazyValue.batteryLevel > 60) {
        return "battery-three-quarters";
      }
      if (this.lazyValue.batteryLevel > 40) {
        return "battery-half";
      }
      if (this.lazyValue.batteryLevel > 20) {
        return "battery-quarter";
      }
      return "battery-empty";
    }
  }
};
</script>
