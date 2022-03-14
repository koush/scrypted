<template>
  <v-list-item ripple :to="getDeviceViewPath(deviceId)">
    <v-list-item-icon>
      <v-icon
        x-small
        :color="device.paused ? 'blue' : device.running ? 'green' : '#a9afbb'"
      >{{ typeToIcon(device.type) }}</v-icon>
    </v-list-item-icon>
    <v-list-item-content>
      <v-list-item-title >{{ name || device.name }}</v-list-item-title>
    </v-list-item-content>
    <v-list-item-action class="mx-0 mt-0 mb-0">
      <span>
        <v-tooltip bottom>
          <template v-slot:activator="{ on }">
            <v-btn
              v-on="on"
              icon
              small
              @click.prevent="device.dock()"
              v-if="device.interfaces.includes('Dock')"
            >
              <v-icon small color="#a9afbb">home</v-icon>
            </v-btn>
          </template>
          <span>Dock</span>
        </v-tooltip>
        <v-btn
          icon
          small
          @click.prevent="device.pause()"
          v-if="device.interfaces.includes('Pause')"
        >
          <v-icon small :color="device.paused ? 'blue' : '#a9afbb'">pause</v-icon>
        </v-btn>
        <v-btn icon small @click.prevent="device.stop()">
          <v-icon small color="#a9afbb">stop</v-icon>
        </v-btn>
        <v-btn icon small @click.prevent="device.start()">
          <v-icon small :color="device.running ? 'green' : '#a9afbb'">play_arrow</v-icon>
        </v-btn>
      </span>
    </v-list-item-action>
  </v-list-item>
</template>
<script>
import DashboardBase from "./DashboardBase";
import { getDeviceViewPath, typeToIcon } from "../helpers";

export default {
  name: "DashboardStartStop",
  mixins: [DashboardBase],
  props: ["name", "deviceId"],
  methods: {
    getDeviceViewPath,
    typeToIcon,
  }
};
</script>