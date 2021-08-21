<template>
  <v-tooltip left>
    <template v-slot:activator="{ on }">
      <font-awesome-icon
        v-on="on"
        v-if="lazyValue.entryOpen"
        class="white--text mr-2 ml-2"
        size="sm"
        icon="door-open"
        color="#a9afbb"
      />
      <font-awesome-icon
        v-on="on"
        v-else
        class="white--text mr-2 ml-2"
        size="sm"
        icon="door-closed"
        color="#a9afbb"
      />
    </template>
    <span>Entry is {{ lazyValue.entryOpen ? 'Open' : 'Closed' }}</span>
  </v-tooltip>
</template>

<script>
import RPCInterface from "../RPCInterface.vue";

export default {
  mixins: [RPCInterface]
};
</script>
