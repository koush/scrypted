<template>
  <v-card>
    <CardTitle >Readme</CardTitle>
    <v-flex v-if="readme">
      <VueMarkdown>{{ readme }}</VueMarkdown>
    </v-flex>
    <v-card-text v-else> Loading... </v-card-text>
  </v-card>
</template>
<script>
import CardTitle from './../components/CardTitle.vue';
import VueMarkdown from "vue-markdown";
import RPCInterface from "./RPCInterface.vue";

export default {
  mixins: [RPCInterface],
  components: {
    VueMarkdown,
    CardTitle,
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
