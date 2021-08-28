<template>
  <v-card-text class="text-md-center font-weight-light body-2 less-padding white--text">
    <span v-if="temperature !== undefined">
      <v-icon x-small color="white">
        thermometer-three-quarters
      </v-icon>
      {{ temperature }}°
    </span>
    <span v-if="humidity !== undefined">
      <font-awesome-icon size="sm" icon="tint" color="white" />
      {{ humidity }}%
    </span>
  </v-card-text>
</template>
<script lang="ts">
import DashboardBase from "./DashboardBase";

export default {
  props: ["type", "group"],
  mixins: [DashboardBase],
  methods: {
    averageProperty(property, propertyInterface) {
      var propertyCount = 0;
      var propertyValue = 0;
      this.type.ids.forEach(id => {
        const device = this.getDevice(id);
        if (device.interfaces.includes(propertyInterface)) {
          propertyCount++;
          propertyValue += device[property];
        }
      });
      if (propertyCount == 0) {
        return undefined;
      }
      return Math.round(propertyValue / propertyCount);
    }
  },
  computed: {
    temperature() {
      return this.averageProperty("temperature", "Thermometer");
    },
    humidity() {
      return this.averageProperty("humidity", "HumiditySensor");
    }
  }
};
</script>
<style>
.less-padding {
    padding: 4px;
}
</style>