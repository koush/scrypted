<template>
  <v-flex>
    <v-card raised class="header-card" style="margin-bottom: 60px">
      <v-card-title
        class="green-gradient subtitle-1 text--white  font-weight-light"
      >
        <font-awesome-icon size="sm" icon="inbox" />&nbsp;&nbsp;Incoming Mail Settings
      </v-card-title>

      <v-form>
        <v-container>
          <v-layout>
            <v-flex xs12>
              <v-text-field
                label="Event Name"
                v-model="lazyValue.eventName"
                persistent-hint
                :hint="`To: 110558071969009568835+${this.lazyValue.eventName}@home.scrypted.app. Forwarding addresses may need to be verified.`"
              ></v-text-field>
            </v-flex>
          </v-layout>
        </v-container>
      </v-form>
      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn @click="verify" color="primary" text>Verify Address</v-btn>
      </v-card-actions>
    </v-card>

    <v-dialog v-model="verifyDialog" width="500">
      <v-card color="blue" dark>
        <v-card-title>Email Verification</v-card-title>
        <v-card-text>
          <pre style="word-break: break-word; white-space: pre-line;">{{verifyStatus}}</pre>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn text @click="verifyDialog = false">Cancel</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-flex>
</template>
<script>
import CustomValue from "../../common/CustomValue.vue";
import cloneDeep from "lodash.clonedeep";
import { getComponentWebPath } from "../helpers";
const eio = require("engine.io-client");

export default {
  mixins: [CustomValue],
  props: ["deviceProps"],
  destroyed() {
    this.finishVerify();
  },
  watch: {
    verifyDialog() {
      if (!this.verifyDialog) {
        this.finishVerify();
      }
    }
  },
  data() {
    return {
      verifyDialog: false,
      verifyStatus: undefined
    };
  },
  methods: {
    finishVerify() {
      if (this.verifySocket) {
        this.verifySocket.close();
        this.verifySocket = undefined;
        return;
      }
    },
    createLazyValue() {
      return cloneDeep(this.deviceProps.device);
    },
    getComponentWebPath,
    verify() {
      this.finishVerify();
      this.verifyDialog = true;
      this.verifyStatus = "Waiting for incoming email...";
      var eioLocation = `${getComponentWebPath("mail")}/verify/engine.io`;
      var address = window.location.protocol + "//" + window.location.host;
      var socket = (this.verifySocket = new eio.Socket(address, {
        path: eioLocation
      }));

      const self = this;
      socket.on("open", () => {
        socket.on("message", str => {
          var json = JSON.parse(str);
          if (json.error) {
            self.verifyStatus = json.error;
          }
        });
        socket.on("close", () => {});
      });
    }
  }
};
</script>