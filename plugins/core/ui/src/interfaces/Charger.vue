<template>
  <v-tooltip left>
    <template v-slot:activator="{ on }">
      <v-icon
        v-on="on"
        v-if="lazyValue.chargeState === Charging"
        class="mr-1 mr-1"
        small
      >fa-plug</v-icon>
      <v-icon
        v-on="on"
        v-else-if="lazyValue.chargeState == Trickle"
        class="mr-1 mr-1"
        small
      >fa-plug-circle-minus</v-icon>
      <v-icon
        v-on="on"
        v-else
        class="mr-1 mr-1"
        small
      >fa-plug-circle-xmark</v-icon>
    </template>
    <span>{{ chargeText }}</span>
  </v-tooltip>
</template>

<script>
import { ChargeState } from '@scrypted/types';
import RPCInterface from "./RPCInterface.vue";

export default {
  mixins: [RPCInterface],
  data() {
    return {
      Charging: ChargeState.Charging,
      Trickle: ChargeState.Trickle,
      NotCharging: ChargeState.NotCharging,
    };
  },
  computed: {
    chargeText() {
      if (this.lazyValue.chargeState === "trickle") {
        return "Trickle Charging";
      }
      if (this.lazyValue.chargeState === "charging") {
        return "Charging";
      }
      return "Not Charging";
    },
  },
};
</script>
