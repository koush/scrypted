<template>
  <span>
    <v-tooltip bottom>
      <template v-slot:activator="{ on }">
        <v-btn small text v-on="on" :href="`/endpoint/${device.id}/public/`">
          <font-awesome-icon size="lg" :icon="['fab', 'chrome']" :color="colors.blue.base" />
        </v-btn>
      </template>
      <span>View the public endpoint of this plugin.</span>
    </v-tooltip>
    <v-tooltip bottom>
      <template v-slot:activator="{ on }">
        <v-btn small text v-on="on" :href="`/endpoint/${device.id}/`">
          <font-awesome-icon size="lg" icon="user-secret" :color="colors.red.base" />
        </v-btn>
      </template>
      <span>View the private http endpoint of this plugin.</span>
    </v-tooltip>
  </span>
</template>
<script>
import RPCInterface from "./RPCInterface.vue";
import colors from "vuetify/es5/util/colors";

export default {
  mixins: [RPCInterface],
  data() {
    return {
      colors
    };
  },
};
</script>