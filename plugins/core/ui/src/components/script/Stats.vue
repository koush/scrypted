<template>
  <v-flex xs6>
    <v-menu offset-y>
      <template v-slot:activator="{ on, attrs }">
        <v-btn
          color="primary"
          dark
          v-bind="attrs"
          v-on="on"
        >Usage: {{ metrics[currentMetric].name }}</v-btn>
      </template>
      <v-list>
        <v-list-item v-for="(item, index) in metrics" :key="index" @click="currentMetric = index">
          <v-list-item-title>{{ item.name }}</v-list-item-title>
        </v-list-item>
      </v-list>
    </v-menu>

    <VueApexCharts
      v-if="chartData"
      type="bar"
      :options="chartData.options"
      :series="chartData.series"
    ></VueApexCharts>
  </v-flex>
</template>
<script>
import axios from "axios";
import VueApexCharts from "vue-apexcharts";

const metrics = [
  {
    name: "CPU Time",
    key: "time",
  },
  {
    name: "Memory",
    key: "heap",
  },
  {
    name: "HTTP",
    key: "http",
  },
  {
    name: "TCP",
    key: "tcp",
  },
  {
    name: "UDP",
    key: "udp",
  },
  {
    name: "Objects",
    key: "object",
  },
];

export default {
  components: {
    VueApexCharts,
  },
  data() {
    return {
      data: null,
      currentMetric: 0,
      metrics,
    };
  },
  methods: {
    getRandomInt() {
      return Math.floor(Math.random() * (50 - 5 + 1)) + 5;
    },
  },
  computed: {
    chartData() {
      if (!this.data) return;

      const data = this.data;

      const chartData = {
        options: {
          chart: {
            id: "vuechart-example",
          },
          xaxis: {
            categories: [],
            tickAmount: 1,
            labels: {
              formatter: function (val) {
                return val.toFixed(0);
              },
            },
          },

          plotOptions: {
            bar: {
              horizontal: true,
            },
          },
        },
        series: [
          {
            name: metrics[this.currentMetric].name,
            data: [],
          },
        ],
      };

      for (const id of Object.keys(data)) {
        const device = this.$scrypted.systemManager.getDeviceById(id);
        if (!device) continue;
        chartData.options.xaxis.categories.push(device.name);
        chartData.series[0].data.push(
          data[id][metrics[this.currentMetric].key]
        );
      }

      return chartData;
    },
  },
  async mounted() {
    const response = await axios.get("/web/component/script/stats");
    this.data = response.data;
  },
};
</script>