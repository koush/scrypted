<template>
  <v-layout row wrap>
    <v-flex xs12 md6 lg4>
      <Settings :device="coreDevice" class="mb-2"></Settings>
      <v-card v-if="updateAvailable">
        <v-toolbar>
          <v-toolbar-title>Update Available </v-toolbar-title>
        </v-toolbar>
        <v-card-text>
          Installed:
          <v-chip x-small color="info">{{ currentVersion }}</v-chip> &nbsp;
          Update: <v-chip color="green" x-small>{{ updateAvailable }}</v-chip>
        </v-card-text>
        <v-card-text v-if="!canUpdate">
          There is an update available for Scrypted. Pull the new docker image
          to upgrade. If you are using Watchtower, an update check and
          installation happens automatically once a day.
        </v-card-text>
        <v-card-text v-else>
          There is an update available for Scrypted.
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn
            v-if="!canUpdate"
            small
            text
            href="https://github.com/koush/scrypted#installation"
            >More Information</v-btn
          >
          <v-dialog v-else v-model="updateAndRestart" width="500">
            <template v-slot:activator="{ on }">
              <v-btn small text color="red" v-on="on"
                >Update and Restart Scrypted</v-btn
              >
            </template>

            <v-card color="red" dark>
              <v-card-title primary-title>Restart Scrypted</v-card-title>

              <v-card-text
                >Are you sure you want to restart the Scrypted
                service?</v-card-text
              >

              <v-card-text>{{ restartStatus }}</v-card-text>
              <v-divider></v-divider>

              <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn text @click="updateAndRestart = false">Cancel</v-btn>
                <v-btn text @click="doUpdateAndRestart">Restart</v-btn>
              </v-card-actions>
            </v-card>
          </v-dialog>
        </v-card-actions>
      </v-card>

      <v-card v-else-if="currentVersion">
        <v-toolbar>
          <v-toolbar-title>Server Version</v-toolbar-title>
        </v-toolbar>
        <v-card-text>
          Current Version: {{ currentVersion }}
        </v-card-text>
        <v-card-text> You're up to date! </v-card-text>
      </v-card>

      <v-card class="mt-2" v-if="showRestart">
        <v-toolbar
          ><v-toolbar-title>Server Management</v-toolbar-title></v-toolbar
        >
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-dialog v-model="restart" width="500">
            <template v-slot:activator="{ on }">
              <v-btn small text color="red" v-on="on">Restart Scrypted</v-btn>
            </template>

            <v-card color="red" dark>
              <v-card-title primary-title>Restart Scrypted</v-card-title>

              <v-card-text
                >Are you sure you want to restart the Scrypted
                service?</v-card-text
              >

              <v-card-text>{{ restartStatus }}</v-card-text>
              <v-divider></v-divider>

              <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn text @click="restart = false">Cancel</v-btn>
                <v-btn text @click="doRestart">Restart</v-btn>
              </v-card-actions>
            </v-card>
          </v-dialog>
        </v-card-actions>
      </v-card>
    </v-flex>
  </v-layout>
</template>
<script>
import { checkUpdate } from "../plugin/plugin";
import Settings from "../../interfaces/Settings.vue"
import {createSystemSettingsDevice} from './system-settings';

export default {
  components: {
    Settings,
  },
  data() {
    return {
      coreDevice: createSystemSettingsDevice(this.$scrypted.systemManager),
      currentVersion: null,
      updateAvailable: null,
      canUpdate: false,
      updateAndRestart: false,
      restart: false,
      restartStatus: undefined,
      showRestart: false,
    };
  },
  mounted() {
    this.loadEnv();
    this.checkUpdateAvailable();
  },
  methods: {
    async checkUpdateAvailable() {
      const info = await this.$scrypted.systemManager.getComponent("info");
      const version = await info.getVersion();
      this.currentVersion = version;
      const { updateAvailable } = await checkUpdate(
        "@scrypted/server",
        version
      );
      this.updateAvailable = updateAvailable;
    },
    async loadEnv() {
      const info = await this.$scrypted.systemManager.getComponent("info");
      const env = await info.getScryptedEnv();
      this.showRestart = !!env.SCRYPTED_CAN_RESTART;
      this.canUpdate = !!env.SCRYPTED_NPM_SERVE || !!env.SCRYPTED_WEBHOOK_UPDATE;
    },
    async doRestart() {
      this.restartStatus = "Restarting...";
      const serviceControl = await this.$scrypted.systemManager.getComponent(
        "service-control"
      );
      await serviceControl.restart();
    },
    async doUpdateAndRestart() {
      this.restartStatus = "Restarting...";
      const serviceControl = await this.$scrypted.systemManager.getComponent(
        "service-control"
      );
      await serviceControl.update();
    },
  },
};
</script>
