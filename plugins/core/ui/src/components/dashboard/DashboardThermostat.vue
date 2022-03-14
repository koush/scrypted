<template>
  <v-list-item ripple :to="getDeviceViewPath(deviceId)">
    <v-list-item-icon>
      <v-icon x-small :color="color">{{ icon }}</v-icon>
    </v-list-item-icon>
    <v-list-item-content>
      <v-list-item-title >{{ name || device.name }}</v-list-item-title>
    </v-list-item-content>

    <v-list-item-action>
      <v-switch color="indigo" inset v-model="on" @click.stop></v-switch>
    </v-list-item-action>
  </v-list-item>
</template>
<script>
import { getDeviceViewPath } from "../helpers";
import { ThermostatMode } from "@scrypted/types";
import DashboardBase from "./DashboardBase";
import colors from "vuetify/es5/util/colors";

export default {
  name: "DashboardThermostat",
  props: ["name", "deviceId"],
  mixins: [DashboardBase],
  methods: {
    getDeviceViewPath
  },

  computed: {
    icon() {
      switch (this.device.thermostatMode) {
        case ThermostatMode.Heat:
          return "fa-fire-alt";
        case ThermostatMode.Cool:
          return "fa-snowflake";
        case ThermostatMode.Eco:
          return "fa-leaf";
      }
      return "fa-thermometer-three-quarters";
    },
    color() {
      if (this.device.thermostatMode === ThermostatMode.Off) {
        return "#a9afbb";
      }

      if (this.device.thermostatMode == ThermostatMode.Heat) {
        return colors.orange.base;
      } else if (this.device.thermostatMode == ThermostatMode.Cool) {
        return colors.blue.base;
      } else if (this.device.thermostatMode == ThermostatMode.Eco) {
        return colors.green.base;
      }
      return colors.orange.base;
    },
    on: {
      get() {
        return this.device.thermostatMode !== ThermostatMode.Off;
      },
      set(val) {
        if (val) {
          this.device.setThermostatMode(ThermostatMode.On);
        } else {
          this.device.setThermostatMode(ThermostatMode.Off);
        }
      }
    }
  }
};
</script>
