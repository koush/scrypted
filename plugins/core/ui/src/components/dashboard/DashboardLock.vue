<template>
  <v-list-item ripple :to="getDeviceViewPath(deviceId)">
    <v-list-item-icon>
      <font-awesome-icon
        class="mt-1"
        size="sm"
        :icon="locked ? 'lock' : 'lock-open'"
        :color="locked ? '#a9afbb' : 'orange'"
      />
    </v-list-item-icon>
    <v-list-item-content>
      <v-list-item-title class="font-weight-light">{{ name || device.name }}</v-list-item-title>
    </v-list-item-content>
    <v-list-item-action>
      <v-btn icon x-small @click.prevent="locked = false">
        <v-icon :color="device.lockState === 'Locked' ? undefined : 'orange'">lock_open</v-icon>
      </v-btn>
    </v-list-item-action>
    <v-list-item-action>
      <v-btn icon x-small @click.prevent="locked = true">
        <v-icon :color="device.lockState === 'Locked' ? 'green' : undefined">lock</v-icon>
      </v-btn>
    </v-list-item-action>
  </v-list-item>
</template>

<script lang="ts">
import DashboardBase from "./DashboardBase";
import { getDeviceViewPath } from "../helpers";

export default {
  name: "DashboardLock",
  mixins: [DashboardBase],
  props: ["name", "deviceId"],
  methods: {
    getDeviceViewPath
  },
  computed: {
    locked: {
      get() {
        return this.device.lockState == "Locked";
      },
      set(val) {
        const device = this.$scrypted.systemManager.getDeviceById(
          this.deviceId
        );
        if (val) {
          device.lock();
        } else {
          device.unlock();
        }
      }
    }
  }
};
</script>
