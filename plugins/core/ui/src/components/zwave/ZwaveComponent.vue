<template>
  <v-layout wrap>
    <v-flex xs12 md6 lg6 v-if="!loading">
      <v-flex>
        <v-card raised class="header-card">
          <v-card-title
            class="orange-gradient subtitle-1 text--white  font-weight-light"
          >Z-Wave Component</v-card-title>

          <div>
            <v-card-text>The Z-Wave component exposes Z-Wave USB controllers to Scrypted plugins. Install a Z-Wave plugin to connect your Z-Wave devices.</v-card-text>
          </div>
        </v-card>
      </v-flex>
      <v-flex>
        <v-layout row wrap>
          <v-flex xs12 lg6 v-for="homeId in settings.homeIds" :key="homeId.id">
            <v-card raised class="header-card">
              <v-card-title
                class="green-gradient subtitle-1 text--white  font-weight-light"
              >Z-Wave Home Id: {{ homeId.id }}</v-card-title>

              <v-flex>
                <v-btn
                  @click="operation('Add Device', homeId.id, 'associate')"
                  block
                  outlined
                  color="info"
                  dark
                  class="mb-1"
                >Add Device</v-btn>
                <v-btn
                  @click="operation('Remove Device', homeId.id, 'remove')"
                  block
                  outlined
                  color="info"
                  dark
                  class="mb-1"
                >Remove Device</v-btn>
                <v-btn
                  append
                  :to="`${homeId.id}`"
                  block
                  outlined
                  color="primary"
                  dark
                  class="mb-1"
                >View Devices</v-btn>
                <v-btn block outlined color="purple" dark class="mb-1">Heal Network</v-btn>
                <v-btn
                  @click="operation('Learn Mode', homeId.id, 'learn')"
                  block
                  outlined
                  color="purple"
                  dark
                  class="mb-1"
                >Learn Mode</v-btn>
                <v-btn block color="red" dark class="mb-1">Reset Controller</v-btn>
              </v-flex>
            </v-card>
          </v-flex>
        </v-layout>
      </v-flex>
    </v-flex>

    <v-dialog v-model="operationDialog" width="500">
      <v-card color="blue" dark>
        <v-card-title>{{ operationName }}</v-card-title>
        <v-card-text>
          <div v-for="(status, index) in operationStatus" :key="index">{{status}}</div>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn text @click="operationDialog = false">Cancel</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-layout>
</template>

<script>
import axios from "axios";
import { getComponentWebPath } from "../helpers";
const eio = require("engine.io-client");

export default {
  data() {
    return {
      loading: true,
      settings: {},

      operationDialog: false,
      operationName: undefined,
      operationStatus: undefined
    };
  },
  computed: {
    componentWebPath() {
      return getComponentWebPath("zwave");
    }
  },
  destroyed() {
    this.finishOperation();
  },
  methods: {
    finishOperation() {
      if (this.operationSocket) {
        this.operationSocket.close();
        this.operationSocket = undefined;
        return;
      }
      this.operationStatus = undefined;
    },
    getComponentWebPath,
    operation(operationName, homeId, operationType) {
      this.finishOperation();
      this.operationName = operationName;
      this.operationDialog = true;
      this.operationStatus = [];
      var eioLocation = `${this.componentWebPath}/${operationType}/${homeId}/engine.io`;
      var address = window.location.protocol + "//" + window.location.host;
      var socket = (this.operationSocket = new eio.Socket(address, {
        path: eioLocation
      }));

      const self = this;
      socket.on("open", () => {
        socket.on("message", str => {
          var json = JSON.parse(str);
          if (json.text) {
            self.operationStatus.push(json.text);
          }
        });
        socket.on("close", () => {});
      });
    },
    refresh() {
      axios.get(`${this.componentWebPath}/settings`).then(response => {
        this.$data.settings = response.data;
        this.loading = false;
      });
    }
  },
  watch: {
    operationDialog() {
      if (!this.operationDialog) {
        this.finishOperation();
      }
    }
  },
  mounted() {
    this.refresh();
  }
};
</script>