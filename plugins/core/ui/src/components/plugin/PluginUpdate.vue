<template>
  <div>
    <div v-if="updating">
      Updating...
    </div>
    <div
      v-else-if="!updateAvailable"
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
import { checkUpdate, installNpm } from "./plugin";

export default {
  props: ["device"],
  mounted() {
    checkUpdate(
      this.device.pluginId,
      this.device.npmPackageVersion
    ).then(({updateAvailable}) => (this.updateAvailable = updateAvailable));
  },
  data() {
    return {
      updating: false,
      updateAvailable: false
    };
  },
  methods: {
    doInstall() {
      this.updating = true;
      installNpm(this.$scrypted.systemManager, this.device.pluginId).then(id => {
        this.updateAvailable = false;
      })
      .finally(() => this.updating = false);
    }
  }
};
</script>