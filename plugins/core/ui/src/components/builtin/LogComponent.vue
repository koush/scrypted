<template>
  <v-flex xs12>
    <LogCard :logRoute="logRoute"></LogCard>
  </v-flex>
</template>
<script>
import LogCard from "./LogCard.vue";

export default {
  components: {
    LogCard
  },
  data() {
    return {
      logRoute: window.location.hash.replace("#/component/log", "")
    };
  },
  watch: {
    $route: {
      deep: true,
      handler() {
        this.logRoute = window.location.hash.replace("#/component/log", "");
      }
    }
  }
};
</script>