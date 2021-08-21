<template>
  <span>
    <v-tooltip bottom>
      <template v-slot:activator="{ on }">
        <v-btn small text v-on="on" @click="viewPublic">
          <font-awesome-icon size="lg" :icon="['fab', 'chrome']" :color="colors.blue.base" />
        </v-btn>
      </template>
      <span>View the public endpoint of this plugin.</span>
    </v-tooltip>
    <v-tooltip bottom>
      <template v-slot:activator="{ on }">
        <v-btn small text v-on="on" @click="viewPrivate">
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
  methods: {
    async viewPublic() {
        const endpoint = await this.rpc().getEndpoint();
        window.open(`/endpoint/${endpoint}/public/`, 'endpoint');
    },
    async viewPrivate() {
        const endpoint = await this.rpc().getEndpoint();
        window.open(`/endpoint/${endpoint}/`, 'endpoint');
    }
  }
};
</script>