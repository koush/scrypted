<template>
  <v-list-item ripple :to="getDeviceViewPath(device.id)">
    <v-list-item-icon>
      <v-icon x-small :color="on ? 'orange' : '#a9afbb'">
        {{ typeToIcon(type) }}
      </v-icon>
    </v-list-item-icon>
    <v-list-item-content>
      <v-list-item-title >{{
        name
      }}</v-list-item-title>
    </v-list-item-content>

    <v-list-item-action>
      <v-switch
        inset
        v-model="on"
        color="white"
        @click.native.stop.prevent
        :light="light"
      ></v-switch>
    </v-list-item-action>
  </v-list-item>
</template>
<script lang="ts">
import { getDeviceViewPath } from "../helpers";
import DashboardBase from "./DashboardBase";
export default {
  props: ["type", "name", "light"],
  mixins: [DashboardBase],
  methods: {
    getDeviceViewPath,
  },
  computed: {
    on: {
      get() {
        return this.device.on;
      },
      set(value) {
        value ? this.device.turnOn() : this.device.turnOff();
      },
    },
  },
};
</script>