<template>
  <v-tooltip left>
    <template v-slot:activator="{ on }">
      <font-awesome-icon
        v-on="on"
        v-if="lazyValue.occupied"
        class="mr-1 mr-1"
        size="sm"
        icon="user"
        color="#a9afbb"
      />
      <font-awesome-icon
        v-on="on"
        v-else
        class="mr-1 mr-1"
        size="sm"
        icon="user-alt-slash"
        color="#a9afbb"
      />
    </template>
    <span>{{ lazyValue.occupied ? 'Occupied' : 'Unoccupied' }}</span>
  </v-tooltip>
</template>

<script>
import RPCInterface from "../RPCInterface.vue";

export default {
  mixins: [RPCInterface]
};
</script>
