<template>
  <v-flex>
    <v-card raised class="header-card" style="margin-bottom: 60px">
      <v-card-title
        class="green-gradient subtitle-1 text--white font-weight-light"
      >
        <font-awesome-icon size="sm" icon="folder-plus" />
        <span class="title font-weight-light">&nbsp;&nbsp;Grouped Devices</span>
      </v-card-title>
      <v-form>
        <v-container>
          <v-layout>
            <v-flex xs12>
              <InterfaceMultiselect
                @input="onChange"
                v-model="device.deviceInterfaces"
                name="Interfaces"
              ></InterfaceMultiselect>
              <InterfaceMultiselect
                @input="onChange"
                v-model="device.deviceEvents"
                name="Events"
              ></InterfaceMultiselect>
            </v-flex>
          </v-layout>
        </v-container>
      </v-form>
    </v-card>
  </v-flex>
</template>
<script>
import cloneDeep from "lodash/cloneDeep";

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
        deviceEvents: [],
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
  computed: {
    mappedInterfaces: {
      get: function () {
        return this.mapThem();
      },
    },
  },
};
</script>