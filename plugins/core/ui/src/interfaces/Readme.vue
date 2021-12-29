<template>
  <v-card>
    <v-card-title class="subtitle-1 font-weight-light">Readme</v-card-title>
    <v-flex v-if="readme">
      <VueMarkdown>{{ readme }}</VueMarkdown>
    </v-flex>
    <v-card-text v-else> Loading... </v-card-text>
  </v-card>
</template>
<script>
import VueMarkdown from "vue-markdown";
import RPCInterface from "./RPCInterface.vue";

export default {
  mixins: [RPCInterface],
  components: {
    VueMarkdown,
  },
  data() {
    return {
      readme: null,
    };
  },
  mounted() {
    this.refresh();
  },
  methods: {
    async refresh() {
      this.readme = await this.rpc().getReadmeMarkdown();
    },
  },
};
</script>
