<template>
  <Device v-if="id" :id="id"></Device>
</template>
<script>
import Device from "./Device.vue";

export default {
  asyncComputed: {
    id: {
      async get() {
        const device = this.$store.state.scrypted.devices
          .map((id) => this.$scrypted.systemManager.getDeviceById(id))
          .find((device) => {
            return device.pluginId === "@scrypted/core" && device.nativeId === "scriptcore";
          });

        return device?.id;
      }
    }
  },
  components: { Device }
};
</script>