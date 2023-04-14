<template>
  <div>
    <v-flex v-if="readme">
      <VueMarkdown :source="readme"></VueMarkdown>
    </v-flex>
    <v-card-text v-else> Loading... </v-card-text>
  </div>
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
      token: 0,
    }
  },
  methods: {
    refresh() {
      this.token++;
    }
  },
  asyncComputed: {
    readme: {
      async get() {
        await this.token;
        return this.device.getReadmeMarkdown();
      },
      default: undefined,
    }
  },
};
</script>
