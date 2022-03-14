<template>
  <v-card raised style="margin-bottom: 30px">
    <v-card-title
    >
      <font-awesome-icon size="sm" icon="folder-plus" />
      <span >&nbsp;&nbsp;Grouped Devices</span>
    </v-card-title>
    <v-flex xs12>
      <InterfaceMultiselect
        @input="onChange"
        :ignore="id"
        v-model="device.deviceInterfaces"
        name="Selected Device Interfaces"
      ></InterfaceMultiselect>
    </v-flex>
    <v-card-actions>
      <v-spacer></v-spacer>
      <v-btn color="primary" text @click="$emit('save')">
        Save Group
      </v-btn>
    </v-card-actions>
  </v-card>
</template>
<script>
import InterfaceMultiselect from "./InterfaceMultiselect.vue";

export default {
  props: ["value", "id", "name", "deviceProps"],
  components: {
    InterfaceMultiselect,
  },
  data: function () {
    let device;
    try {
      device = JSON.parse(this.value);
    } catch (e) {
      device = {
        deviceInterfaces: [],
      };
    }

    return {
      device,
    };
  },
  methods: {
    onChange() {
      this.$emit("input", JSON.stringify(this.device));
    },
  },
};
</script>