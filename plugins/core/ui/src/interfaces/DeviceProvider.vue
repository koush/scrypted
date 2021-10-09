<template>
  <v-flex xs12>
    <v-card-text>These things were created by {{ device.name }}.</v-card-text>
    <DeviceGroup :deviceGroup="managedDevices"></DeviceGroup>
  </v-flex>
</template>
<script>
import RPCInterface from "./RPCInterface.vue";
import DeviceGroup from "../common/DeviceTable.vue";

export default {
  mixins: [RPCInterface],
  components: {
    DeviceGroup,
  },
  computed: {
      managedDevices() {
        const devices = this.$store.state.scrypted.devices
        .filter(
          id =>
            this.$store.state.systemState[id].providerId.value ===
            this.device.id && this.device.id !== id
        )
        .map(id => ({
          id,
          name: this.$store.state.systemState[id].name.value,
          type: this.$store.state.systemState[id].type.value
        }));

        return {
            devices,
        }
      }
  },
};
</script>
