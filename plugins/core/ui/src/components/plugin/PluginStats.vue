<template>
  <v-layout row>
    <v-flex xs12 md6>
      <Stats
        v-if="cpuInteresting.length"
        :interesting="cpuInteresting"
        v-model="value"
        label="CPU Usage (Seconds)"
        :labels="cpuLabels"
        :series="cpuSeries"
      />
    </v-flex>
    <v-flex xs12 md6>
      <Stats
        v-if="memoryInteresting.length"
        :interesting="memoryInteresting"
        v-model="value"
        label="Memory Usage (MB)"
        :labels="memoryLabels"
        :series="memorySeries"
      />
    </v-flex>
  </v-layout>
</template>

<script>
import Stats from "./Stats.vue";
export default {
  components: {
    Stats,
  },
  props: ["value"],
  computed: {
    cpuInteresting() {
      const cpu = this.value
        .slice()
        .sort(
          (d1, d2) =>
            d1.stats.cpu.system +
            d1.stats.cpu.user -
            (d2.stats.cpu.system + d2.stats.cpu.user)
        )
        .reverse()
        .slice(0, 10);
      return cpu;
    },
    cpuLabels() {
      return this.cpuInteresting.map((device) => device.name);
    },
    cpuSeries() {
      const series = this.cpuInteresting
        .map((device) => Math.round((device.stats.cpu.system + device.stats.cpu.user) / 1000000))
        .sort();
      return series;
    },
    memoryInteresting() {
      const cpu = this.value
        .slice()
        .sort(
          (d1, d2) =>
            d1.stats.memoryUsage.heapTotal - d2.stats.memoryUsage.heapTotal
        )
        .reverse()
        .slice(0, 10);
      return cpu;
    },
    memoryLabels() {
      return this.memoryInteresting.map((device) => device.name);
    },
    memorySeries() {
      const series = this.memoryInteresting
        .map((device) => Math.round(device.stats.memoryUsage.heapTotal / 1000000))
        .sort();
      return series;
    },
  },
};
</script>
