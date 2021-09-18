<template>
  <v-card style="height: 400px">
    <v-card-title>{{ label }}</v-card-title>
      <apexchart
        type="donut"
        height="300"
        width="100%"
        :options="chartOptions"
        :series="series"
      ></apexchart>
  </v-card>
</template>

<script>
export default {
  props: ["labels", "series", "label"],
  computed: {
    chartOptions() {
      return {
        chart: {
          type: "donut",
          animations: {
            speed: 400,
          },
          background: "transparent",
        },
        stroke: {
          show: true,
          colors: [this.$vuetify.theme.isDark ? "#333" : "#fff"],
          width: 1,
          dashArray: 0,
        },
        plotOptions: {
          pie: {
            expandOnClick: false,
            donut: {
              size: "74%",
            },
          },
        },

        labels: this.labels,
        dataLabels: {
          enabled: false,
        },
        legend: {
          show: this.$vuetify.breakpoint.smAndUp,
          offsetY: 0,
          fontSize: "13px",
          fontFamily: "Quicksand",
          fontWeight: 700,
        },
        ...this.options,
      };
    },
  },
};
</script>
