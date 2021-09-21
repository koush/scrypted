<template>
  <v-layout row>
    <v-flex xs12 md6>
      <Stats
        v-if="cpuInteresting.length"
        :interesting="cpuInteresting"
        label="CPU Usage (Seconds)"
        :labels="cpuLabels"
        :series="cpuSeries"
        @dataPointSelection="dataPointSelection($event, cpuInteresting)"
      />
    </v-flex>
    <v-flex xs12 md6>
      <Stats
        v-if="memoryInteresting.length"
        :interesting="memoryInteresting"
        label="Memory Usage (MB)"
        :labels="memoryLabels"
        :series="memorySeries"
        @dataPointSelection="dataPointSelection($event, memoryInteresting)"
      />
    </v-flex>
    <v-flex xs12 md6>
      <Stats
        v-if="objectInteresting.length"
        :interesting="objectInteresting"
        label="RPC Objects"
        :labels="objectLabels"
        :series="objectSeries"
        @dataPointSelection="dataPointSelection($event, objectInteresting)"
      />
    </v-flex>
  </v-layout>
</template>

<script>
import { getDeviceViewPath } from '../helpers';
import Stats from "./Stats.vue";
export default {
  components: {
    Stats,
  },
  props: ["value"],
  methods: {
    dataPointSelection(e, series) {
      const {id} = series[e.dataPointIndex];
      this.$router.push(getDeviceViewPath(id));
    }
  },
  computed: {
    cpuInteresting() {
      const cpu = this.value
        .slice()
        .filter(d => !!d.stats?.cpu)
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
        .map((device) =>
          Math.round(
            (device.stats.cpu.system + device.stats.cpu.user) / 1000000
          )
        );
      return series;
    },
    memoryInteresting() {
      const memory = this.value
        .slice()
        .filter(d => !!d.stats?.memoryUsage)
        .sort(
          (d1, d2) =>
            d1.stats.memoryUsage.heapTotal - d2.stats.memoryUsage.heapTotal
        )
        .reverse()
        .slice(0, 10);
      return memory;
    },
    memoryLabels() {
      return this.memoryInteresting.map((device) => device.name);
    },
    memorySeries() {
      const series = this.memoryInteresting
        .map((device) => Math.round(device.stats.memoryUsage.heapTotal / 1000000));
      return series;
    },
    objectInteresting() {
      const objects = this.value
        .slice()
        .filter(d => !!d.rpcObjects)
        .sort((d1, d2) => d1.rpcObjects - d2.rpcObjects)
        .reverse()
        .slice(0, 10);
      return objects;
    },
    objectLabels() {
      return this.objectInteresting.map((device) => device.name);
    },
    objectSeries() {
      const series = this.objectInteresting.slice()
        .map((device) => device.rpcObjects);
      return series;
    },
  },
};
</script>
