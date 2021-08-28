<template>
  <v-flex>
    <v-card raised  style="margin-bottom: 60px">
      <v-card-title class="green-gradient subtitle-1 text--white font-weight-light">
        <font-awesome-icon size="sm" icon="database" />
        <span class="title font-weight-light">&nbsp;&nbsp;Managed Device</span>
      </v-card-title>
      <v-card-text></v-card-text>
      <v-card-text>
        <b>Native ID:</b>
        {{ device.internalId }}
      </v-card-text>
      <v-card-actions>
        <v-btn text color="primary" @click="showStorage = !showStorage">Storage</v-btn>
        <v-spacer></v-spacer>
        <v-btn text color="blue" :to="`/device/${ownerDevice.id}`">{{ ownerDevice.name }}</v-btn>
      </v-card-actions>
    </v-card>

    <v-card v-if="showStorage" raised  style="margin-bottom: 60px">
      <v-card-title class="green-gradient subtitle-1 text--white font-weight-light">Script Storage</v-card-title>
      <v-flex>
        <Storage v-model="device.configuration" @input="onChange"></Storage>
      </v-flex>
    </v-card>
  </v-flex>
</template>
<script>
import Storage from "../../common/Storage";
import cloneDeep from "lodash/cloneDeep";

export default {
  props: ["value", "id", "name", "deviceProps"],
  components: {
    Storage
  },
  data: function() {
    return {
      device: cloneDeep(this.deviceProps.device),
      showStorage: false
    };
  },
  methods: {
    onChange() {
      this.$emit("input", this.device);
    }
  },
  computed: {
    ownerDevice() {
      const id = this.id;
      const ownerPlugin = this.$store.state.systemState[id].metadata.value
        .ownerPlugin;
      return {
        id: ownerPlugin,
        name: this.$store.state.systemState[ownerPlugin].name.value,
        type: this.$store.state.systemState[ownerPlugin].type.value
      };
    }
  }
};
</script>