<template>
  <v-card>
    <card-toolbar >Readme</card-toolbar>
    <v-flex v-if="readme">
      <VueMarkdown>{{ readme }}</VueMarkdown>
    </v-flex>
    <v-card-text v-else> Loading... </v-card-text>
  </v-card>
</template>
<script>
import CardToolbar from './../components/CardToolbar.vue';
import VueMarkdown from "vue-markdown";
import RPCInterface from "./RPCInterface.vue";

export default {
  mixins: [RPCInterface],
  components: {
    VueMarkdown,
    CardToolbar,
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
