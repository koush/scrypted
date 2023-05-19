<template>
  <span>
    <v-tooltip bottom>
      <template v-slot:activator="{ on }">
        <v-btn small text v-on="on" :href="endpointHref">
          <font-awesome-icon size="lg" :icon="['fab', 'chrome']" :color="colors.blue.base" />
        </v-btn>
      </template>
      <span>View the public endpoint of this plugin.</span>
    </v-tooltip>
  </span>
</template>
<script>
import { getCurrentBaseUrl } from "../../../../../packages/client/src";
import RPCInterface from "./RPCInterface.vue";
import colors from "vuetify/es5/util/colors";

export default {
  mixins: [RPCInterface],
  data() {
    const baseUrl = getCurrentBaseUrl();
    const endpoint = `endpoint/${this.device.id}/public/`;
    const endpointHref = baseUrl ? new URL(endpoint, baseUrl).pathname : '/' + endpoint;

    return {
      endpointHref,
      colors
    };
  },
};
</script>