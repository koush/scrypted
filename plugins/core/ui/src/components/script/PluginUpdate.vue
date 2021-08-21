<template>
  <div>
    <div
      v-if="!updateAvailable"
      class="body-2 font-weight-light"
    >{{ device.npmPackageVersion }}</div>
    <v-btn
      @click="doInstall"
      small
      dark
      block
      outlined
      v-else
      color="blue"
    >Update</v-btn>
  </div>
</template>
<script>
import { getDeviceViewPath } from "../helpers";

import { checkUpdate, installNpm } from "./plugin";

export default {
  props: ["device"],
  mounted() {
    checkUpdate(
      this.device.pluginId,
      this.device.npmPackageVersion
    ).then(updateAvailable => (this.updateAvailable = updateAvailable));
  },
  data() {
    return {
      updateAvailable: false
    };
  },
  methods: {
    doInstall() {
      installNpm(this.device.id, this.device.pluginId).then(id =>
        this.$router.push(getDeviceViewPath(id))
      );
    }
  }
};
</script>