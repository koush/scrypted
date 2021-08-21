<template>
  <v-layout wrap>
    <v-flex xs12 md6 lg6 v-if="!loading">
      <v-flex>
        <v-card raised class="header-card">
          <v-card-title
            class="orange-gradient subtitle-1 text--white  font-weight-light"
          >HomeKit Accessory Bridge</v-card-title>

          <div>
            <v-card-text>Enable the Scrypted HomeKit Accessory Bridge ands connect your iOS devices using the Home app.</v-card-text>
            <v-card-text>HomeKit pairing code: 031-45-154</v-card-text>
          </div>

          <v-card-actions>
            <v-spacer></v-spacer>
            <v-btn outlined color="orange" @click="disable" v-if="settings.enable === 'Enabled'">Disable</v-btn>
            <v-btn outlined color="orange" @click="enable" v-if="settings.enable !== 'Enabled'">Enable</v-btn>
          </v-card-actions>
        </v-card>
      </v-flex>
    </v-flex>
  </v-layout>
</template>
<script>
import axios from "axios";
import qs from 'query-string';
import { getComponentWebPath } from "../helpers";

export default {
  data() {
    return {
      loading: true,
      settings: {},
    };
  },
  computed: {
    componentWebPath() {
      return getComponentWebPath("homekit");
    },
  },
  methods: {
    refresh() {
      axios.get(`${this.componentWebPath}/settings`).then(response => {
        this.$data.settings = response.data;
        this.loading = false;
      });
    },
    disable() {
      axios
        .post(
          `${this.componentWebPath}/`,
          qs.stringify({
            enable: "Disabled"
          })
        )
        .then(() => this.refresh());
    },
    enable() {
      axios
        .post(
          `${this.componentWebPath}/`,
          qs.stringify({
            enable: "Enabled"
          })
        )
        .then(() => this.refresh());
    }
  },
  mounted() {
    this.refresh();
  }
};
</script>