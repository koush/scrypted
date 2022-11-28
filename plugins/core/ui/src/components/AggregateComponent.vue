<template>
  
</template>
<script>
import { findPluginDevice, getDeviceViewPath } from "./helpers";

export default {
  async mounted() {
    const core = findPluginDevice(this.$scrypted.systemManager, '@scrypted/core', 'aggregatecore');
    this.$router.replace(getDeviceViewPath(core.id));
  },
};
</script>