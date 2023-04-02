<template>
  <v-tooltip left>
    <font-awesome-icon class="white--text mr-1 mr-1" size="sm" :icon="chargeIcon" color="#a9afbb" />
    <span>{{ chargeText }}</span>
  </v-tooltip>
</template>

<script>
import RPCInterface from "./RPCInterface.vue";

export default {
  mixins: [RPCInterface],
  computed: {
    chargeIcon() {
      if (this.lazyValue.chargeState === "trickle") {
        return "plug";
      }
      if (this.lazyValue.chargeState === "charging") {
        return "plug-circle-bolt";
      }
      return "plug-circle-xmark";
    },
    chargeText() {
      if (this.lazyValue.chargeState === "trickle") {
        return "Trickle Charging";
      }
      if (this.lazyValue.chargeState === "charging") {
        return "Charging";
      }
      return "Not Charging";
    }
  }
};
</script>
