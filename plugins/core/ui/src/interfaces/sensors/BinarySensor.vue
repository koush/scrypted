<template>
  <v-tooltip left>
    <template v-slot:activator="{ on }">
      <v-icon
        v-on="on"
        v-if="lazyValue.binaryState"
        class="mr-1 mr-1"
        small
      >fa-circle</v-icon>
      <v-icon
        v-on="on"
        v-else
        class="mr-1 mr-1"
        small
      >far fa-circle</v-icon>
    </template>
    <span>{{ !lazyValue.binaryState ? 'Binary State True ' : 'Binary State False' }}</span>
  </v-tooltip>
</template>

<script>
import RPCInterface from "../RPCInterface.vue";

export default {
  mixins: [RPCInterface]
};
</script>
