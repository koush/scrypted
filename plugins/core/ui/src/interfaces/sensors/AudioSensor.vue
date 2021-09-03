<template>
  <v-tooltip left>
    <template v-slot:activator="{ on }">
      <v-icon
        v-on="on"
        v-if="lazyValue.audioDetected"
        class="mr-1 mr-1"
        small
      >fa-volume-up</v-icon>
      <v-icon
        v-on="on"
        v-else
        class="mr-1 mr-1"
        small
      >fa-volume-mute</v-icon>
    </template>
    <span>{{ !lazyValue.audioDetected ? 'No ' : '' }}Audio Detected</span>
  </v-tooltip>
</template>

<script>
import RPCInterface from "../RPCInterface.vue";

export default {
  mixins: [RPCInterface]
};
</script>
